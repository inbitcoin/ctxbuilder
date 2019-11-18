declare module '@inbitcoin/ctxbuilder' {
  class ColoredCoinsBuilder {
    constructor(properties: {
      network: "mainnet" | "testnet" | "regtest";
      defaultFee?: number;
      defaultFeePerKb?: number;
      minDustValue?: number;
      softMaxUtxos?: number;
    })

    public buildSendTransaction(args: any): ICapiBuiltTransaction
    public buildIssueTransaction(args: any): ICapiBuiltIssueTransaction
  }

  export = ColoredCoinsBuilder
}

declare interface ICapiBuiltTransaction {
  txHex: string
  coloredOutputIndexes: number[]
}

declare interface ICapiBuiltIssueTransaction {
  assetId: string
  txHex: string
  coloredOutputIndexes: number[]
}
