const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("=== AegisNet Protocol Smart Contract Deployment ===");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with account: ${deployer.address}`);

  const rootName = process.env.ENS_ROOT_NAME || "aegisnet.eth";
  const worldIdGroupId = process.env.WORLD_ID_GROUP_ID || 1;
  const externalNullifier = process.env.WORLD_ID_EXTERNAL_NULLIFIER || 1;

  // 1. AegisSubnameRegistry
  console.log("1. Deploying AegisSubnameRegistry...");
  const Registry = await ethers.getContractFactory("AegisSubnameRegistry");
  const registry = await Registry.deploy(rootName);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`> AegisSubnameRegistry deployed at: ${registryAddr}`);

  // 2. MockWorldID / WorldID
  console.log("2. Deploying MockWorldID Verifier...");
  const WorldID = await ethers.getContractFactory("MockWorldID");
  const worldID = await WorldID.deploy();
  await worldID.waitForDeployment();
  const worldIdAddr = await worldID.getAddress();
  console.log(`> MockWorldID deployed at: ${worldIdAddr}`);

  // 3. AegisExecutionManager
  console.log("3. Deploying AegisExecutionManager...");
  const Manager = await ethers.getContractFactory("AegisExecutionManager");
  const manager = await Manager.deploy(
    registryAddr,
    worldIdAddr,
    worldIdGroupId,
    externalNullifier,
    deployer.address // Relayer signer
  );
  await manager.waitForDeployment();
  const managerAddr = await manager.getAddress();
  console.log(`> AegisExecutionManager deployed at: ${managerAddr}`);

  // 4. AegisSwapVMAdapter
  console.log("4. Deploying AegisSwapVMAdapter (1inch)...");
  const SwapVM = await ethers.getContractFactory("AegisSwapVMAdapter");
  const swapVM = await SwapVM.deploy(managerAddr);
  await swapVM.waitForDeployment();
  const swapVMAddr = await swapVM.getAddress();
  console.log(`> AegisSwapVMAdapter deployed at: ${swapVMAddr}`);

  // 5. AegisUniswapV4Hook
  console.log("5. Deploying AegisUniswapV4Hook (Uniswap v4)...");
  const Hook = await ethers.getContractFactory("AegisUniswapV4Hook");
  const hook = await Hook.deploy(registryAddr, managerAddr);
  await hook.waitForDeployment();
  const hookAddr = await hook.getAddress();
  console.log(`> AegisUniswapV4Hook deployed at: ${hookAddr}`);

  const deploymentData = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    rootName,
    deployer: deployer.address,
    contracts: {
      AegisSubnameRegistry: registryAddr,
      WorldIDVerifier: worldIdAddr,
      AegisExecutionManager: managerAddr,
      AegisSwapVMAdapter: swapVMAddr,
      AegisUniswapV4Hook: hookAddr,
    },
    timestamp: new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, "../deployment-config.json");
  fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2));
  console.log(`Saved deployment info to: ${outputPath}`);

  // Also mirror to backend config if backend exists
  const backendConfigDir = path.join(__dirname, "../../backend/src/config");
  if (!fs.existsSync(backendConfigDir)) {
    fs.mkdirSync(backendConfigDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(backendConfigDir, "contracts.json"),
    JSON.stringify(deploymentData, null, 2)
  );
  console.log(`Mirrored deployment config to backend: ${path.join(backendConfigDir, "contracts.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
