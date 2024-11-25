import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

const config: HardhatUserConfig = {
  solidity: '0.8.19',
  typechain: {
    outDir: './src/typechain-types', // Specify the output directory
    target: 'ethers-v6', // Specify the target (e.g., ethers-v6)
  },
  paths: {
    sources: './contracts', // Solidity contracts directory
    cache: './cache', // Cache directory
    artifacts: './artifacts', // Artifacts directory
  },
  networks: {
    hardhat: {},
    // Add other networks like Goerli, Mainnet, etc., as needed
    coti2Testnet: {
      url: 'https://testnet.coti.io/rpc',
    },
  },
};

export default config;
