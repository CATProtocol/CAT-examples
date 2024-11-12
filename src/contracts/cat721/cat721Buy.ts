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
    PubKey,
    Sig,
    SmartContract,
    assert,
    hash160,
    method,
    prop,
    sha256,
    FixedArray,
} from 'scrypt-ts'

const MAX_OTHER_OUTPUT = 3

export class CAT721Buy extends SmartContract {
    @prop()
    cat721Script: ByteString

    @prop()
    localId: int32

    @prop()
    buyerAddress: ByteString

    constructor(
        cat721Script: ByteString,
        localId: int32,
        buyerAddress: ByteString
    ) {
        super(...arguments)
        this.cat721Script = cat721Script
        this.localId = localId
        this.buyerAddress = buyerAddress
    }

    @method()
    public take(
        curTxoStateHashes: TxoStateHashes,
        nftInputIndex: int32,
        nftLocalId: int32,
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
            assert(hash160(pubKeyPrefix + ownerPubKey) == this.buyerAddress)
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
            // ensure inputs have one nft input
            assert(spentScriptsCtx[Number(nftInputIndex)] == this.cat721Script)

            // to buyer
            const buyerNftStateHash = CAT721Proto.stateHash({
                localId: this.localId !== -1n ? this.localId : nftLocalId,
                ownerAddr: this.buyerAddress,
            })
            const toBuyerNftOutput = TxUtil.buildOutput(
                this.cat721Script,
                nftSatoshiBytes
            )

            // output
            const curStateHashes = hash160(buyerNftStateHash)
            const curStateCnt = 1n
            const stateOutput = StateUtils.getCurrentStateOutput(
                curStateHashes,
                curStateCnt,
                curTxoStateHashes
            )

            let outputs = stateOutput + toBuyerNftOutput
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
