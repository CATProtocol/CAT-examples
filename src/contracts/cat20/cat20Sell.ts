import {
    SmartContract,
    prop,
    ByteString,
    method,
    PubKey,
    Sig,
    hash160,
    toByteString,
    Int32,
    assert,
    TxUtils,
    Ripemd160,
    TxOut,
    PubKeyHash,
} from '@scrypt-inc/scrypt-ts-btc'
import { SellUtil } from './sellUtil'
import { OpMul } from '@scrypt-inc/scrypt-ts-lib-btc'
import { CAT20, OwnerUtils } from '@cat-protocol/cat-sdk-v2'
import { DexState } from './types'

export class CAT20Sell extends SmartContract<DexState> {
    @prop()
    cat20Script: ByteString

    @prop()
    recvOutput: ByteString

    @prop()
    sellerAddress: ByteString

    @prop()
    price: Int32

    @prop()
    scalePrice: boolean

    constructor(
        cat20Script: ByteString,
        recvOutput: ByteString,
        sellerAddress: ByteString,
        price: Int32,
        scalePrice: boolean
    ) {
        super(...arguments)
        this.cat20Script = cat20Script
        this.recvOutput = recvOutput
        this.sellerAddress = sellerAddress
        this.price = price
        this.scalePrice = scalePrice
    }

    @method()
    public take(
        tokenInputIndex: Int32,
        toBuyUserAmount: Int32,
        sellChange: Int32,
        buyUserAddress: PubKeyHash,
        tokenSatoshiBytes: ByteString,
        // sig data
        cancel: boolean,
        pubKeyPrefix: ByteString,
        ownerPubKey: PubKey,
        ownerSig: Sig,
        serviceFeeInfo: TxOut
    ) {
        // check preimage
        if (cancel) {
            assert(
                OwnerUtils.toLockingScript(pubKeyPrefix, ownerPubKey) ==
                    this.sellerAddress
            )
            assert(this.checkSig(ownerSig, ownerPubKey))
        } else {
            // ensure inputs have one token input
            assert(
                this.ctx.spentScripts[Number(tokenInputIndex)] ==
                    this.cat20Script
            )
            assert(sellChange >= 0n)
            // build outputs

            // to buyer
            this.appendStateOutput(
                TxUtils.buildOutput(this.cat20Script, tokenSatoshiBytes),
                CAT20.stateHash({
                    amount: toBuyUserAmount,
                    ownerAddr: buyUserAddress,
                })
            )

            // sell token change
            if (sellChange > 0n) {
                this.appendStateOutput(
                    TxUtils.buildOutput(this.cat20Script, tokenSatoshiBytes),
                    CAT20.stateHash({
                        amount: sellChange,
                        ownerAddr: hash160(this.ctx.spentScript),
                    })
                )
            }

            // satoshi to seller
            const satoshiToSeller = OpMul.mul(this.price, toBuyUserAmount)
            this.appendStateOutput(
                TxUtils.buildOutput(
                    this.recvOutput,
                    SellUtil.int32ToSatoshiBytes(
                        satoshiToSeller,
                        this.scalePrice
                    )
                ),
                toByteString('') as Ripemd160
            )

            const outputs =
                this.buildStateOutputs() +
                TxUtils.buildChangeOutput(serviceFeeInfo) +
                this.buildChangeOutput()
            assert(
                this.checkOutputs(outputs),
                'Outputs mismatch with the transaction context'
            )
        }
    }
}
