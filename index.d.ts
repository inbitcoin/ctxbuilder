declare module '@inbitcoin/ctxbuilder' {
  class ColoredCoinsBuilder {
    constructor(properties: IBuilderArgs)

    public buildSendTransaction(args: IBuilderArgsSend): Promise<ICapiBuiltTransaction>

    public buildIssueTransaction(args: IBuilderArgsIssue): Promise<ICapiBuiltIssueTransaction>
  }

  export = ColoredCoinsBuilder
}

declare interface IBuilderArgs {
  network: 'mainnet' | 'testnet' | 'regtest'
  minDustValue?: number
  softMaxUtxos?: number
}

declare interface IBuilderArgsSend {
  utxos: Array<ICapiUtxo>
  to: Array<{ address: string; amount: number; amountBtc?: number }>
  changeAddress: string | (() => Promise<string>)
  bitcoinChangeAddress?: string | (() => Promise<string>)
  fee?: number
  feePerKb?: number
}

declare interface IBuilderArgsIssue {
  utxos: Array<ICapiUtxo>
  issueAddress: string
  amount: number
  divisibility?: number
  aggregationPolicy?: string
  transfer?: Array<{ address: string; amount: number }>
  change?: string
  financeChangeAddress?: string
  fee: number
  reissuable?: boolean
  flags?: any
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
