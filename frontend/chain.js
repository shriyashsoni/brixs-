/**
 * AegisChain: every AegisNet contract action, signed by the connected wallet.
 * Nothing here goes through the backend wallet. Requires ethers (UMD) and AegisWallet.
 */
(function () {
  'use strict';

  var ethers = window.ethers;
  var cfg = null; // { contracts, abis, chainId }

  function init(health, abis) {
    cfg = {
      contracts: health.contracts,
      chainId: health.expectedChainId || health.chainId || 11155111,
      abis: abis,
    };
  }

  function requireInit() {
    if (!cfg) throw new Error('The app is still loading contract settings. Try again in a moment.');
    if (!ethers) throw new Error('ethers failed to load. Reload the page.');
  }

  // ---------------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------------
  function reason(err) {
    if (!err) return 'Transaction failed';
    if (err.code === 'ACTION_REJECTED' || err.code === 4001 || (err.info && err.info.error && err.info.error.code === 4001)) {
      return 'You rejected the transaction in your wallet.';
    }
    if (err.code === 'INSUFFICIENT_FUNDS') return 'Not enough Sepolia ETH for gas. Get some from a Sepolia faucet.';
    var r = err.reason || (err.revert && err.revert.args && err.revert.args[0]) ||
      (err.info && err.info.error && err.info.error.message) || err.shortMessage || err.message || 'Transaction failed';
    return String(r).replace(/^execution reverted:?\s*/i, '');
  }

  // ---------------------------------------------------------------------------
  // Signer / contracts
  // ---------------------------------------------------------------------------
  async function signer() {
    requireInit();
    var w = window.AegisWallet.get();
    var raw = window.AegisWallet.provider();
    if (!w.connected || !raw) throw new Error('Connect your wallet first.');
    var want = '0x' + Number(cfg.chainId).toString(16);
    if ((w.chainId || '').toLowerCase() !== want) {
      await window.AegisWallet.ensureSepolia();
    }
    var bp = new ethers.BrowserProvider(raw, 'any');
    return bp.getSigner();
  }

  function contract(name, runner) {
    var map = {
      registry: [cfg.contracts.AegisSubnameRegistry, cfg.abis.registry],
      manager: [cfg.contracts.AegisExecutionManager, cfg.abis.manager],
      hook: [cfg.contracts.AegisUniswapV4Hook, cfg.abis.hook],
    };
    return new ethers.Contract(map[name][0], map[name][1], runner);
  }

  /** Send a transaction with progress callbacks: 'sign' → 'pending' (hash) → 'mined' (receipt) */
  async function send(label, build, onStatus) {
    onStatus = onStatus || function () {};
    try {
      onStatus({ step: 'sign', label: label });
      var tx = await build();
      onStatus({ step: 'pending', label: label, hash: tx.hash });
      var receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error(label + ' reverted onchain');
      onStatus({ step: 'mined', label: label, hash: receipt.hash });
      return receipt;
    } catch (err) {
      var e = new Error(reason(err));
      e.cause = err;
      onStatus({ step: 'failed', label: label, error: e.message });
      throw e;
    }
  }

  function findEvent(c, receipt, name) {
    for (var i = 0; i < receipt.logs.length; i++) {
      try {
        var parsed = c.interface.parseLog(receipt.logs[i]);
        if (parsed && parsed.name === name) return parsed;
      } catch (e) { /* other contract's log */ }
    }
    return null;
  }

  function usdToWei(usd) { return ethers.parseEther(Number(usd).toFixed(6)); }
  function poolId(label) {
    return /^0x[0-9a-fA-F]{64}$/.test(label) ? label : ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  /** Register + whitelist the SwapVM adapter and Uniswap hook (3 transactions) */
  async function registerAgent(opts, onStatus) {
    var s = await signer();
    var registry = contract('registry', s);
    var r1 = await send('Register ENS identity', function () {
      return registry.registerSubname(opts.label, opts.agent, usdToWei(opts.thresholdUSD), usdToWei(opts.dailyLimitUSD));
    }, onStatus);
    var ev = findEvent(registry, r1, 'SubnameRegistered');
    var node = ev ? ev.args.subnameNode : await registry.agentToNode(opts.agent);

    var r2 = await send('Allow the 1inch SwapVM adapter', function () {
      return registry.setTargetContractWhitelist(node, cfg.contracts.AegisSwapVMAdapter, true);
    }, onStatus);
    var r3 = await send('Allow the Uniswap v4 hook', function () {
      return registry.setTargetContractWhitelist(node, cfg.contracts.AegisUniswapV4Hook, true);
    }, onStatus);
    return { node: node, txHashes: [r1.hash, r2.hash, r3.hash] };
  }

  async function setWhitelist(node, target, allowed, onStatus) {
    var registry = contract('registry', await signer());
    return send(allowed ? 'Allow target' : 'Block target', function () {
      return registry.setTargetContractWhitelist(node, target, allowed);
    }, onStatus);
  }

  async function setThreshold(node, usd, onStatus) {
    var registry = contract('registry', await signer());
    return send('Update approval threshold', function () { return registry.updateBiometricThreshold(node, usdToWei(usd)); }, onStatus);
  }

  async function revoke(node, onStatus) {
    var registry = contract('registry', await signer());
    return send('Revoke agent', function () { return registry.revokeSubname(node); }, onStatus);
  }

  async function setText(node, key, value, onStatus) {
    var registry = contract('registry', await signer());
    return send('Set text record', function () { return registry.setTextRecord(node, key, value); }, onStatus);
  }

  /** The connected wallet acts as the agent: the contract authorizes msg.sender */
  async function requestExecution(target, callData, usd, onStatus) {
    var manager = contract('manager', await signer());
    var receipt = await send('Submit trade request', function () {
      return manager.requestExecution(target, callData, usdToWei(usd));
    }, onStatus);
    var ev = findEvent(manager, receipt, 'ExecutionRequested');
    if (!ev) throw new Error('The transaction did not emit ExecutionRequested');
    var executed = !!findEvent(manager, receipt, 'ExecutionExecuted');
    return {
      requestId: ev.args.requestId,
      requiresBiometrics: ev.args.requiresBiometrics,
      executed: executed,
      txHash: receipt.hash,
    };
  }

  async function submitApproval(requestId, nullifierHash, signature, onStatus) {
    var manager = contract('manager', await signer());
    return send('Record World ID approval', function () {
      return manager.verifyBiometricsWithRelayer(requestId, BigInt(nullifierHash), signature);
    }, onStatus);
  }

  async function executeVerified(requestId, onStatus) {
    var manager = contract('manager', await signer());
    return send('Execute approved trade', function () { return manager.executeVerifiedTransaction(requestId); }, onStatus);
  }

  async function cancel(requestId, onStatus) {
    var manager = contract('manager', await signer());
    return send('Cancel trade', function () { return manager.cancelExecution(requestId); }, onStatus);
  }

  async function setPoolGated(label, gated, onStatus) {
    var hook = contract('hook', await signer());
    return send(gated ? 'Gate pool to agents' : 'Open pool', function () { return hook.setPoolGated(poolId(label), gated); }, onStatus);
  }

  async function balanceOf(address) {
    var raw = window.AegisWallet.provider();
    if (!raw || !address) return null;
    try {
      var bp = new ethers.BrowserProvider(raw, 'any');
      return Number(ethers.formatEther(await bp.getBalance(address)));
    } catch (e) {
      return null;
    }
  }

  window.AegisChain = {
    init: init,
    ready: function () { return !!cfg; },
    reason: reason,
    registerAgent: registerAgent,
    setWhitelist: setWhitelist,
    setThreshold: setThreshold,
    revoke: revoke,
    setText: setText,
    requestExecution: requestExecution,
    submitApproval: submitApproval,
    executeVerified: executeVerified,
    cancel: cancel,
    setPoolGated: setPoolGated,
    balanceOf: balanceOf,
    poolId: poolId,
  };
})();
