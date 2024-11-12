import {
    CAT721Proto,
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
    StateUtils,
    TxUtil,
    TxoStateHashes,
    int32,
} from '@cat-protocol/cat-sdk'
import {
    ByteString,
    FixedArray,
    PubKey,
    PubKeyHash,
    Sig,
    SmartContract,
    assert,
    hash160,
    method,
    prop,
    sha256,
} from 'scrypt-ts'

const MAX_OTHER_OUTPUT = 3

export class CAT721Sell extends SmartContract {
    @prop()
    cat721Script: ByteString

    @prop()
    localId: int32

    @prop()
    recvOutput: ByteString

    @prop()
    recvSatoshiBytes: ByteString

    @prop()
    sellerAddress: ByteString

    constructor(
        cat721Script: ByteString,
        localId: int32,
        recvOutput: ByteString,
        recvSatoshiBytes: ByteString,
        sellerAddress: ByteString
    ) {
        super(...arguments)
        this.cat721Script = cat721Script
        this.localId = localId
        this.recvOutput = recvOutput
        this.recvSatoshiBytes = recvSatoshiBytes
        this.sellerAddress = sellerAddress
    }

    @method()
    public take(
        curTxoStateHashes: TxoStateHashes,
        nftInputIndex: int32,
        nftLocalId: int32,
        buyUserAddress: PubKeyHash,
        nftSatoshiBytes: ByteString,
        // sig data
        cancel: boolean,
        pubKeyPrefix: ByteString,
        ownerPubKey: PubKey,
        ownerSig: Sig,
        // ctxs
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx,
        outputList: FixedArray<ByteString, typeof MAX_OTHER_OUTPUT>
    ) {
        assert(prevoutsCtx.inputIndexVal == 0n)
        // check preimage
        if (cancel) {
            assert(hash160(pubKeyPrefix + ownerPubKey) == this.sellerAddress)
            assert(this.checkSig(ownerSig, ownerPubKey))
        } else {
            // Check sighash preimage.
            assert(
                this.checkSig(
                    SigHashUtils.checkSHPreimage(shPreimage),
                    SigHashUtils.Gx
                ),
                'preimage check error'
            )
            // check ctx
            SigHashUtils.checkPrevoutsCtx(
                prevoutsCtx,
                shPreimage.hashPrevouts,
                shPreimage.inputIndex
            )
            SigHashUtils.checkSpentScriptsCtx(
                spentScriptsCtx,
                shPreimage.hashSpentScripts
            )
            // ensure inputs have one token input
            assert(spentScriptsCtx[Number(nftInputIndex)] == this.cat721Script)
            // build outputs

            // to buyer
            const curStateHashes: ByteString = hash160(
                CAT721Proto.stateHash({
                    localId: this.localId !== -1n ? this.localId : nftLocalId,
                    ownerAddr: buyUserAddress,
                })
            )
            const toBuyerTokenOutput = TxUtil.buildOutput(
                this.cat721Script,
                nftSatoshiBytes
            )

            // satoshi to seller
            const toSellerOutput = TxUtil.buildOutput(
                this.recvOutput,
                this.recvSatoshiBytes
            )

            //
            const curStateCnt: bigint = 1n
            const stateOutput = StateUtils.getCurrentStateOutput(
                curStateHashes,
                curStateCnt,
                curTxoStateHashes
            )
            let outputs = stateOutput + toBuyerTokenOutput + toSellerOutput
            for (let i = 0; i < MAX_OTHER_OUTPUT; i++) {
                outputs += outputList[i]
            }
            const hashOutputs = sha256(outputs)
            assert(
                hashOutputs == shPreimage.hashOutputs,
                'hashOutputs mismatch'
            )
        }
    }
}
