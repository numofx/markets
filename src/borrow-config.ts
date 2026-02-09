export const BORROW_CONFIG = {
  assetIds: {
    kesm: "0x634b45530000",
    usdt: "0x555344540000",
  },
  baseIds: {
    kesm: "0x4b45536d0000",
  },
  core: {
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
    fyKesm: "0x2EcECD30c115B6F1eA612205A04cf3cF77049503",
    kesm: "0x456a3D042C0DbD3db53D5489e98dFb038553B0d0",
    // Native USDT on Celo (USD₮)
    usdt: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  },
} as const;
