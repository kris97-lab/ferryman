import { ELYSIUM, HYPEREVM, ADDR } from '../config'

// The Arbitrum SDK is most of the bundle, so it loads on first use (diagnosis,
// withdrawal status, claim) instead of on page load.

const ZERO = '0x0000000000000000000000000000000000000000'

let loading: Promise<typeof import('@arbitrum/sdk')> | null = null

export function loadSdk() {
  loading ??= import('@arbitrum/sdk').then((sdk) => {
    // Elysium is an Orbit chain with native HYPE gas on a HyperEVM parent, so the
    // stock Arbitrum SDK works once the network is registered. The rollup is BoLD.
    sdk.registerCustomArbitrumNetwork({
      name: ELYSIUM.name,
      chainId: ELYSIUM.chainId,
      parentChainId: HYPEREVM.chainId,
      confirmPeriodBlocks: 10,
      isCustom: true,
      isTestnet: true,
      isBold: true,
      ethBridge: {
        bridge: ADDR.hyperevm.bridge,
        inbox: ADDR.hyperevm.inbox,
        sequencerInbox: ADDR.hyperevm.sequencerInbox,
        outbox: ADDR.hyperevm.outbox,
        rollup: ADDR.hyperevm.rollup,
      },
      tokenBridge: {
        parentGatewayRouter: ADDR.hyperevm.gatewayRouter,
        childGatewayRouter: ADDR.elysium.gatewayRouter,
        parentErc20Gateway: ADDR.hyperevm.erc20Gateway,
        childErc20Gateway: ADDR.elysium.erc20Gateway,
        parentCustomGateway: ZERO,
        childCustomGateway: ZERO,
        parentWethGateway: ZERO,
        childWethGateway: ZERO,
        parentWeth: ZERO,
        childWeth: ZERO,
        parentMultiCall: ZERO,
        childMultiCall: ADDR.elysium.multicall3,
      },
    })
    return sdk
  })
  return loading
}
