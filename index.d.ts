declare module '@inbitcoin/ctxbuilder' {
  class ColoredCoinsBuilder {
    constructor(properties: {
      network: "mainnet" | "testnet" | "regtest";
      defaultFee?: number;
      defaultFeePerKb?: number;
      minDustValue?: number;
      softMaxUtxos?: number;
    })

    public buildSendTransaction(args: {
      utxos: Array<ICapiUtxo>
      to: Array<{ address: string; amount: number }>
      changeAddress: string | (() => Promise<string>)
      bitcoinChangeAddress?: string | (() => Promise<string>)
      fee?: number
      defaultFee?: number
    }): ICapiBuiltTransaction
    public buildIssueTransaction(args: {
      utxos: Array<ICapiUtxo>
      issueAddress?: string
      amount: number
      divisibility?: number
      aggregationPolicy?: string
      to?: Array<{ address: string; amount: number }>
      changeAddress: string | (() => Promise<string>)
      bitcoinChangeAddress?: string | (() => Promise<string>)
      fee?: number
      defaultFee?: number
    }): ICapiBuiltIssueTransaction
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

declare interface IScriptPubKey {
  asm?: string
  hex: string
  reqSig?: number
  type?: string
  addresses: string[]
}

declare interface IAsset {
  assetId: string
  amount: number
  issueTxid: string
  divisibility: number
  lockStatus: boolean
  aggregationPolicy: string
}

declare interface ICapiUtxo {
  index: number
  txid: string
  value: number
  used: boolean
  scriptPubKey: IScriptPubKey
  assets: IAsset[]
}
