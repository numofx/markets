export const BORROW_CONFIG = {
  assetIds: {
    kesm: "0x634b45530000",
    usdt: "0x555344540000",
  },
  baseCngn: {
    chainId: 8453,
    core: {
      cauldron: "0x56Fae1964908C387a8F27342D098104A496FC6B2",
      ladle: "0x2F9cC9E1114859aD18FADFD0cf6Ac90F583b6C83",
    },
    ilk: {
      aUsdc: "0x615553444300",
    },
    joins: {
      aUsdc: "0x2F9d4A146b0Dbe47681F10D0639fB8491Eb36421",
      cNgn: "0x8834aDaa8AeF40350ac3152230925f940dd99DAF",
    },
    pool: {
      address: "0xbbae8d0df541aadf9d6a5db3515d40fb228bf782",
      g1Fee: 9990,
      lpToken: "0xbbae8d0df541aadf9d6a5db3515d40fb228bf782",
      maturity: 1_778_112_000,
      routePreference: "serve",
      timeStretch64x64: "0x22244466688",
    },
    seriesId: {
      fycNgn: "0x000069fbd600",
    },
  },
  baseIds: {
    kesm: "0x4b45536d0000",
  },
  core: {
    cauldron: "0x18f552AcD039A83cb2e003f9d12FC65868408669",
    ladle: "0x29F8028Fc13E2Fc9E708a1b69E79B96A7F675220",
    mentoSpotOracle: "0x7bA3A70AF7825715025DD8567aA1665D3C93a1De",
    witch: "0x6E6C4b791eAD28786c1eCfb45cA498894f9656FC",
  },
  ilk: {
    usdt: "0x555344540000",
  },
  joins: {
    kesm: "0x139bA35639d4411CBD2c14908ECFfEb634402f45",
    usdt: "0x55bf8434Aa8eecdAd5b657fa124c2B487D8a7814",
  },
  seriesId: {
    fyKesm: "0x000069f8a660",
  },
  tokens: {
    aUsdc: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",

    // Base cNGN market
    cNgn: "0x46C85152bFe9f96829aA94755D9f915F9B10EF5F",
    fycNgn: "0x757937525FD12bA22A1820ac2ff65666B8C1DB34",
    fyKesm: "0x2EcECD30c115B6F1eA612205A04cf3cF77049503",
    kesm: "0x456a3D042C0DbD3db53D5489e98dFb038553B0d0",
    // Native USDT on Celo (USD₮)
    usdt: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  },
} as const;
