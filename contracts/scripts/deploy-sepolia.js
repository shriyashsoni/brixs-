const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("=========================================================");
  console.log("🚀 AegisNet Sepolia Testnet Deployment Script");
  console.log("=========================================================");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Deployer Account: ${deployer.address}`);
  console.log(`Account Balance : ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error("❌ ERROR: Deployer account has 0 Sepolia ETH. Please fund account with Sepolia ETH before deploying.");
    process.exit(1);
  }

  const rootName = process.env.ENS_ROOT_NAME || "aegisnet.eth";
  const worldIdSepoliaRouter = process.env.WORLD_ID_SEPOLIA_ROUTER || "0x719683F13Eeea7D84fCBa5d7d17Bf82e03E3d260";
  const worldIdGroupId = process.env.WORLD_ID_GROUP_ID || 1;
  const externalNullifier = process.env.WORLD_ID_EXTERNAL_NULLIFIER || 1;

  // 1. AegisSubnameRegistry
  console.log("\n1. Deploying AegisSubnameRegistry...");
  const Registry = await ethers.getContractFactory("AegisSubnameRegistry");
  const registry = await Registry.deploy(rootName);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`> AegisSubnameRegistry deployed at: ${registryAddr}`);

  // 2. World ID Verifier (Uses official Sepolia World ID Router or deploys MockWorldID)
  let worldIdAddr = worldIdSepoliaRouter;
  if (process.env.USE_MOCK_WORLD_ID === "true" || !worldIdSepoliaRouter) {
    console.log("\n2. Deploying MockWorldID Verifier...");
    const WorldID = await ethers.getContractFactory("MockWorldID");
    const worldID = await WorldID.deploy();
    await worldID.waitForDeployment();
    worldIdAddr = await worldID.getAddress();
    console.log(`> MockWorldID deployed at: ${worldIdAddr}`);
  } else {
    console.log(`\n2. Using Official Sepolia World ID Router at: ${worldIdAddr}`);
  }

  // 3. AegisExecutionManager
  console.log("\n3. Deploying AegisExecutionManager...");
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

  // 4. AegisSwapVMAdapter (1inch)
  console.log("\n4. Deploying AegisSwapVMAdapter (1inch Aqua)...");
  const SwapVM = await ethers.getContractFactory("AegisSwapVMAdapter");
  const swapVM = await SwapVM.deploy(managerAddr);
  await swapVM.waitForDeployment();
  const swapVMAddr = await swapVM.getAddress();
  console.log(`> AegisSwapVMAdapter deployed at: ${swapVMAddr}`);

  // 5. AegisUniswapV4Hook (Uniswap v4)
  console.log("\n5. Deploying AegisUniswapV4Hook (Uniswap v4)...");
  const Hook = await ethers.getContractFactory("AegisUniswapV4Hook");
  const hook = await Hook.deploy(registryAddr, managerAddr);
  await hook.waitForDeployment();
  const hookAddr = await hook.getAddress();
  console.log(`> AegisUniswapV4Hook deployed at: ${hookAddr}`);

  const network = await ethers.provider.getNetwork();

  const deploymentData = {
    network: network.name,
    chainId: network.chainId.toString(),
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

  // Mirror to backend config
  const backendConfigDir = path.join(__dirname, "../../backend/src/config");
  if (!fs.existsSync(backendConfigDir)) {
    fs.mkdirSync(backendConfigDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(backendConfigDir, "contracts.json"),
    JSON.stringify(deploymentData, null, 2)
  );

  console.log("\n=========================================================");
  console.log("✅ ALL SMART CONTRACTS SUCCESSFULLY DEPLOYED TO SEPOLIA!");
  console.log(`Deployment config saved to: ${outputPath}`);
  console.log("=========================================================");
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exitCode = 1;
});
