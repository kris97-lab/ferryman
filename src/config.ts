// Elysium testnet + its parent chain (HyperEVM testnet).
// Addresses from https://elysium.kinetiq.xyz/docs/contract-addresses

export const ELYSIUM = {
  chainId: 99801,
  name: 'Elysium Testnet',
  rpc: 'https://testnet-rpc.elysium.kinetiq.xyz',
  // explorer pages live at /tx/<hash> and /address/<addr> on this host
  explorer: 'https://testnet.elysium.kinetiq.xyz',
}

export const HYPEREVM = {
  chainId: 998,
  name: 'HyperEVM Testnet',
  rpc: 'https://rpc.hyperliquid-testnet.xyz/evm',
  explorer: 'https://testnet.hyperevm-explorer.xyz',
  // public RPC caps eth_getLogs at 1000 blocks
  maxLogRange: 1000,
}

export const HL_INFO_API = 'https://api.hyperliquid-testnet.xyz/info'

export const ADDR = {
  elysium: {
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
    whype: '0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234',
    usdc: '0x7D29d8047B905000459c0E80c34a26CeedcB47b2',
    gatewayRouter: '0x89659883a9d980925733B0A698F117AAb65ac718',
    erc20Gateway: '0x30545d8b24185DdFe83E75aB6939f867b664e2E1',
    arbSys: '0x0000000000000000000000000000000000000064',
    arbRetryableTx: '0x000000000000000000000000000000000000006E',
    nodeInterface: '0x00000000000000000000000000000000000000C8',
    bridgeFactory: '0xb94A38a4aC46970559E89E566f2486a3Fc56BE5a',
    bridgeWalletGateway: '0x7255150a0340852Fe4B4B5657C5AcE6c09a4F959',
  },
  hyperevm: {
    rollup: '0xEbf08e34941fd93a0Fc1cD89dbBF7447267039Df',
    bridge: '0x36dAbc3CEE2E1084B7d04c8015Ef68Cac78f4f37',
    inbox: '0x11178Df40CBf87a4343f4B3F8B09B366ceFA8Ec0',
    outbox: '0x87391D602aaffB3Fe8051EcCDb75d6EEe8C31060',
    sequencerInbox: '0xb5B1a0AebfFeF819Ec3F8c39a17b5C4E70A001E3',
    gatewayRouter: '0x1aAE2caD8B0249905492087EF230FcCEa3707C45',
    erc20Gateway: '0x792487eF5E423104bec94e8c58E814e5E0450cEA',
    mirrorGateway: '0x08922Faa84aC2a54aa3cFD3725b03ca256F52Da2',
    mirrorFactory: '0xcaDb9986F3727177d48FA07294E1730f9D19290b',
  },
} as const

export const ABI = {
  erc20: [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
  ],
  erc20Bytes32: ['function name() view returns (bytes32)', 'function symbol() view returns (bytes32)'],
  // canonical bridge representation on Elysium exposes its parent token
  arbToken: ['function l1Address() view returns (address)'],
  gatewayRouter: [
    'function getGateway(address token) view returns (address)',
    'function calculateL2TokenAddress(address token) view returns (address)',
  ],
  arbRetryableTx: [
    'function getTimeout(bytes32 ticketId) view returns (uint256)',
    'function getBeneficiary(bytes32 ticketId) view returns (address)',
    'function getLifetime() view returns (uint256)',
    'function redeem(bytes32 ticketId) returns (bytes32)',
    'event TicketCreated(bytes32 indexed ticketId)',
    'event RedeemScheduled(bytes32 indexed ticketId, bytes32 indexed retryTxHash, uint64 indexed sequenceNum, uint64 donatedGas, address gasDonor, uint256 maxRefund, uint256 submissionFeeRefund)',
    'event Canceled(bytes32 indexed ticketId)',
    'event LifetimeExtended(bytes32 indexed ticketId, uint256 newTimeout)',
  ],
  multicall3: [
    'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
  ],
  bridgeFactory: [
    'function expectedL1Mirror(address elysiumToken) view returns (address)',
    'function predictL2Wallet(address elysiumToken) view returns (address)',
    'function l2WalletFor(address elysiumToken) view returns (address)',
    'function createL2Wallet(address elysiumToken) returns (address)',
  ],
  mirrorFactory: [
    'function predictL1Mirror(address elysiumToken, string name, string symbol, uint8 decimals) view returns (address)',
    'function l1MirrorFor(address elysiumToken, string name, string symbol, uint8 decimals) view returns (address)',
    'function expectedL2Wallet(address mirror) view returns (address)',
    'function elysiumTokenOf(address mirror) view returns (address)',
  ],
}

// EIP-1967 / beacon storage slots, used to flag upgradeable (mutable) tokens
export const SLOTS = {
  implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
}
