const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AegisNet Matrix Core Protocol Tests", function () {
  let owner, agent, user;
  let registry, executionManager, swapVMAdapter, uniswapHook, mockWorldID, mockToken;

  const ROOT_NAME = "shriyash.eth";
  const SUBNAME_LABEL = "agent1";
  const BIOMETRIC_THRESHOLD = ethers.parseEther("1000"); // $1000 USD threshold
  const DAILY_LIMIT = ethers.parseEther("50000");

  beforeEach(async function () {
    [owner, agent, user] = await ethers.getSigners();

    // 1. Deploy AegisSubnameRegistry
    const RegistryFactory = await ethers.getContractFactory("AegisSubnameRegistry");
    registry = await RegistryFactory.deploy(ROOT_NAME);
    await registry.waitForDeployment();

    // 2. Deploy Mock World ID Verifier
    const WorldIDFactory = await ethers.getContractFactory("MockWorldID");
    mockWorldID = await WorldIDFactory.deploy();
    await mockWorldID.waitForDeployment();

    // 3. Deploy AegisExecutionManager
    const ManagerFactory = await ethers.getContractFactory("AegisExecutionManager");
    executionManager = await ManagerFactory.deploy(
      await registry.getAddress(),
      await mockWorldID.getAddress(),
      1, // Group ID
      1, // External Nullifier
      owner.address // Relayer Signer
    );
    await executionManager.waitForDeployment();

    // 4. Deploy 1inch SwapVM Adapter
    const SwapVMFactory = await ethers.getContractFactory("AegisSwapVMAdapter");
    swapVMAdapter = await SwapVMFactory.deploy(await executionManager.getAddress());
    await swapVMAdapter.waitForDeployment();

    // 5. Deploy Uniswap v4 Agent-Gated Hook
    const HookFactory = await ethers.getContractFactory("AegisUniswapV4Hook");
    uniswapHook = await HookFactory.deploy(
      await registry.getAddress(),
      await executionManager.getAddress()
    );
    await uniswapHook.waitForDeployment();

    // 6. Deploy Mock ERC20 Token
    const TokenFactory = await ethers.getContractFactory("MockERC20");
    mockToken = await TokenFactory.deploy("USD Coin", "USDC");
    await mockToken.waitForDeployment();
  });

  describe("Phase I: Identity & Delegation (ENSv2 EAC)", function () {
    it("Should register agent subname and set EAC target whitelists", async function () {
      const tx = await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );
      await tx.wait();

      const subnameNode = await registry.agentToNode(agent.address);
      expect(subnameNode).to.not.equal(ethers.ZeroHash);

      // Whitelist SwapVM Adapter target contract
      await registry.connect(owner).setTargetContractWhitelist(
        subnameNode,
        await swapVMAdapter.getAddress(),
        true
      );

      const [isAllowed, requiresBio] = await registry.isAgentAuthorized(
        agent.address,
        await swapVMAdapter.getAddress(),
        ethers.parseEther("500")
      );

      expect(isAllowed).to.be.true;
      expect(requiresBio).to.be.false; // $500 < $1000 threshold
    });

    it("Should flag high-value actions for World ID biometric interception", async function () {
      await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );

      const subnameNode = await registry.agentToNode(agent.address);
      await registry.connect(owner).setTargetContractWhitelist(
        subnameNode,
        await swapVMAdapter.getAddress(),
        true
      );

      // Check transaction value $2,500 >= $1,000 threshold
      const [isAllowed, requiresBio] = await registry.isAgentAuthorized(
        agent.address,
        await swapVMAdapter.getAddress(),
        ethers.parseEther("2500")
      );

      expect(isAllowed).to.be.true;
      expect(requiresBio).to.be.true;
    });

    it("Should set and resolve ENSIP-26 Agent Text Records (agent.capabilities & agent.biometric_threshold)", async function () {
      await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );

      const subnameNode = await registry.agentToNode(agent.address);

      await registry.connect(owner).setTextRecord(subnameNode, "agent.capabilities", "1inch-swapvm,uniswap-v4-hook");
      await registry.connect(owner).setTextRecord(subnameNode, "agent.biometric_threshold", "1000");

      const capRecord = await registry.getTextRecord(subnameNode, "agent.capabilities");
      const bioRecord = await registry.getTextRecord(subnameNode, "agent.biometric_threshold");

      expect(capRecord).to.equal("1inch-swapvm,uniswap-v4-hook");
      expect(bioRecord).to.equal("1000");
    });
  });

  describe("Phase II & III: Strategy Execution & World ID Biometric Interception", function () {
    beforeEach(async function () {
      await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );

      const subnameNode = await registry.agentToNode(agent.address);
      await registry.connect(owner).setTargetContractWhitelist(
        subnameNode,
        await swapVMAdapter.getAddress(),
        true
      );
    });

    it("Should auto-execute transactions below $1,000 threshold", async function () {
      const instructions = [
        {
          opcode: 1, // OP_EXCHANGE_SWAP
          tokenIn: await mockToken.getAddress(),
          tokenOut: await mockToken.getAddress(),
          amountIn: ethers.parseEther("100"),
          minAmountOut: ethers.parseEther("99"),
          extraData: "0x"
        }
      ];

      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      // Request low-value execution ($500)
      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("500")
      );
      const receipt = await tx.wait();

      const reqEvent = receipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested");
      expect(reqEvent).to.not.be.undefined;
      expect(reqEvent.args.requiresBiometrics).to.be.false;
    });

    it("Should intercept transaction above $1,000 and enforce World ID relayer verification", async function () {
      const instructions = [
        {
          opcode: 1,
          tokenIn: await mockToken.getAddress(),
          tokenOut: await mockToken.getAddress(),
          amountIn: ethers.parseEther("5000"),
          minAmountOut: ethers.parseEther("4900"),
          extraData: "0x"
        }
      ];

      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      // Request high-value execution ($5,000 > $1,000)
      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("5000")
      );
      const receipt = await tx.wait();

      const reqEvent = receipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested");
      const requestId = reqEvent.args.requestId;
      expect(reqEvent.args.requiresBiometrics).to.be.true;

      // Verification before biometrics should fail
      await expect(
        executionManager.connect(agent).executeVerifiedTransaction(requestId)
      ).to.be.revertedWith("AegisManager: pending biometric verification");

      // Verify via Relayer signature
      const nullifierHash = 123456789;
      const managerAddr = await executionManager.getAddress();
      const network = await ethers.provider.getNetwork();
      
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "address", "uint256"],
        [requestId, nullifierHash, managerAddr, network.chainId]
      );
      
      const sig = await owner.signMessage(ethers.getBytes(messageHash));

      await executionManager.connect(user).verifyBiometricsWithRelayer(
        requestId,
        nullifierHash,
        sig
      );

      // Now execution should succeed!
      const execTx = await executionManager.connect(agent).executeVerifiedTransaction(requestId);
      const execReceipt = await execTx.wait();
      
      const execEvent = execReceipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionExecuted");
      expect(execEvent.args.success).to.be.true;
    });
  });

  describe("Phase IV: Uniswap v4 Agent-Gated Hook", function () {
    it("Should allow gated swap when invoked via AegisExecutionManager for authorized subname", async function () {
      await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );

      const subnameNode = await registry.agentToNode(agent.address);
      await registry.connect(owner).setTargetContractWhitelist(
        subnameNode,
        await uniswapHook.getAddress(),
        true
      );

      const poolId = ethers.keccak256(ethers.toUtf8Bytes("USDC-WETH-0.05%"));
      await uniswapHook.connect(owner).setPoolGated(poolId, true);

      // Direct caller check validation
      const tx = await uniswapHook.connect(agent).beforeSwap(
        await executionManager.getAddress(),
        poolId,
        ethers.parseEther("200")
      );
      expect(tx).to.not.be.undefined;
    });
  });

  describe("Phase V: 1inch Aqua Protocol & SwapVM Custom Opcode Positions ($7k 1inch Track)", function () {
    beforeEach(async function () {
      await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );

      const subnameNode = await registry.agentToNode(agent.address);
      await registry.connect(owner).setTargetContractWhitelist(
        subnameNode,
        await swapVMAdapter.getAddress(),
        true
      );
    });

    it("Should construct and execute custom 1inch Aqua position deposit (OP_AQUA_DEPOSIT 0x05) via SwapVM", async function () {
      const instructions = [
        {
          opcode: 5, // OP_AQUA_DEPOSIT
          tokenIn: await mockToken.getAddress(),
          tokenOut: await mockToken.getAddress(),
          amountIn: ethers.parseEther("500"),
          minAmountOut: ethers.parseEther("500"),
          extraData: "0x"
        }
      ];

      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("500")
      );
      await tx.wait();

      const posCount = await swapVMAdapter.getAgentAquaPositionCount(await executionManager.getAddress());
      expect(posCount).to.equal(1n);
    });

    it("Should execute 1inch Aqua position rebalancing & harvest yield (OP_AQUA_WITHDRAW 0x06)", async function () {
      const depositInstructions = [
        {
          opcode: 5, // OP_AQUA_DEPOSIT
          tokenIn: await mockToken.getAddress(),
          tokenOut: await mockToken.getAddress(),
          amountIn: ethers.parseEther("800"),
          minAmountOut: ethers.parseEther("800"),
          extraData: "0x"
        },
        {
          opcode: 6, // OP_AQUA_WITHDRAW
          tokenIn: await mockToken.getAddress(),
          tokenOut: await mockToken.getAddress(),
          amountIn: ethers.parseEther("800"),
          minAmountOut: ethers.parseEther("816"), // 2% yield expectation
          extraData: "0x"
        }
      ];

      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [depositInstructions]
        )
      ]);

      // Execution request
      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("800")
      );
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });
  });
});

