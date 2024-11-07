import {
    ByteString,
    PubKey,
    Sig,
    SmartContract,
    assert,
    hash160,
    int2ByteString,
    len,
    method,
    prop,
    sha256,
    toByteString,
} from 'scrypt-ts'
import {
    ChangeInfo,
    STATE_OUTPUT_INDEX,
    TxUtil,
    int32,
} from '@cat-protocol/cat-smartcontracts'
import {
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '@cat-protocol/cat-smartcontracts'
import { CAT721Proto, CAT721State } from '@cat-protocol/cat-smartcontracts'
import {
    PreTxStatesInfo,
    StateUtils,
    TxoStateHashes,
} from '@cat-protocol/cat-smartcontracts'
import { TxProof, XrayedTxIdPreimg2 } from '@cat-protocol/cat-smartcontracts'
import { CAT20Proto, CAT20State } from '@cat-protocol/cat-smartcontracts'

//
export const MINIMAL_LOCKED_BLOCKS = 17n

export class LockToMint extends SmartContract {
    @prop()
    cat721Script: ByteString

    @prop()
    cat20Script: ByteString

    @prop()
    lockTokenAmount: int32

    @prop()
    nonce: ByteString

    @prop()
    lockedBlocks: bigint

    constructor(
        cat721Script: ByteString,
        cat20Script: ByteString,
        lockTokenAmount: int32,
        nonce: ByteString,
        lockedBlocks: bigint
    ) {
        super(...arguments)
        this.cat721Script = cat721Script
        this.cat20Script = cat20Script
        this.lockTokenAmount = lockTokenAmount
        this.nonce = nonce
        this.lockedBlocks = lockedBlocks
    }

    @method()
    static buildCatTimeLockP2wsh(
        pubkey: ByteString,
        nonce: ByteString,
        lockedBlocks: int32
    ): ByteString {
        // exec in legacy bvm runtime, ecdsa sig
        // <pubkey1><pubkey2><nonce><lockedBlocks>76b2516d005579515679567952ae6b6d6d6c77
        let pubkey1 = pubkey
        let pubkey2 = pubkey
        if (len(pubkey) == 32n) {
            pubkey1 = toByteString('02') + pubkey
            pubkey2 = toByteString('03') + pubkey
        }
        assert(lockedBlocks >= MINIMAL_LOCKED_BLOCKS)
        const lockedBlocksBytes = int2ByteString(lockedBlocks)
        return (
            toByteString('0020') +
            sha256(
                toByteString('21') +
                    pubkey1 +
                    toByteString('21') +
                    pubkey2 +
                    int2ByteString(len(nonce)) +
                    nonce +
                    int2ByteString(len(lockedBlocksBytes)) +
                    lockedBlocksBytes +
                    toByteString('76b2516d005579515679567952ae6b6d6d6c77')
            )
        )
    }

    @method()
    public claimNft(
        //
        curTxoStateHashes: TxoStateHashes,
        nftReceiver: CAT721State,
        // cat20 tx info
        cat20Tx: XrayedTxIdPreimg2,
        cat20OutputVal: int32,
        cat20OutputIndex: ByteString,
        cat20State: CAT20State,
        cat20TxStatesInfo: PreTxStatesInfo,
        // cat20 owner pubkey and sig
        cat20OwnerPubKeyPrefix: ByteString,
        cat20OwnerPubkeyX: PubKey,
        cat20OwnerPubkeySig: Sig,
        //
        cat20Change: int32,
        // satoshis locked in contract
        contractSatoshis: ByteString,
        // ctxs
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx,
        changeInfo: ChangeInfo
    ) {
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
        // ensure input 0 is nft input
        assert(spentScriptsCtx[0] == this.cat721Script)
        // ensure input 1 is token input
        assert(spentScriptsCtx[1] == this.cat20Script)

        // verify cat20 state
        const catTx20Txid = TxProof.getTxIdFromPreimg2(cat20Tx)
        TxUtil.checkIndex(cat20OutputVal, cat20OutputIndex)
        assert(catTx20Txid + cat20OutputIndex == prevoutsCtx.prevouts[1])
        // verifyPreStateHash
        StateUtils.verifyPreStateHash(
            cat20TxStatesInfo,
            CAT20Proto.stateHash(cat20State),
            cat20Tx.outputScriptList[STATE_OUTPUT_INDEX],
            cat20OutputVal
        )

        // verify pubkey can sig, exec in taproot bvm runtime, schnorr sig
        const pubkey = cat20OwnerPubKeyPrefix + cat20OwnerPubkeyX
        assert(hash160(pubkey) == cat20State.ownerAddr)
        this.checkSig(cat20OwnerPubkeySig, cat20OwnerPubkeyX)

        // build catTimeLock p2wsh
        const timeLockScript = LockToMint.buildCatTimeLockP2wsh(
            pubkey,
            this.nonce,
            this.lockedBlocks
        )

        // build outputs
        let curStateHashes = toByteString('')
        let curStateCnt = 2n

        // nft to user
        curStateHashes += hash160(CAT721Proto.stateHash(nftReceiver))
        const nftOutput = TxUtil.buildOutput(
            this.cat721Script,
            contractSatoshis
        )

        // token to lock contract address
        curStateHashes += hash160(
            CAT20Proto.stateHash({
                amount: this.lockTokenAmount,
                ownerAddr: hash160(timeLockScript),
            })
        )
        const tokenOutput = TxUtil.buildOutput(
            this.cat20Script,
            contractSatoshis
        )

        // if change token amount more than 0, change to user
        let tokenChangeOutput = toByteString('')
        if (cat20Change > 0n) {
            // cat20State
            curStateCnt += 1n
            curStateHashes += hash160(
                CAT20Proto.stateHash({
                    ownerAddr: cat20State.ownerAddr,
                    amount: cat20Change,
                })
            )
            tokenChangeOutput = TxUtil.buildOutput(
                this.cat20Script,
                contractSatoshis
            )
        }

        // time lock output
        const catTimeLockOutput = TxUtil.buildOutput(
            timeLockScript,
            contractSatoshis
        )

        // change satoshi
        const changeOutput = TxUtil.getChangeOutput(changeInfo)

        // final build state output
        const stateOutput = StateUtils.getCurrentStateOutput(
            curStateHashes,
            curStateCnt,
            curTxoStateHashes
        )
        const hashOutputs = sha256(
            stateOutput +
                nftOutput +
                tokenOutput +
                tokenChangeOutput +
                catTimeLockOutput +
                changeOutput
        )
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
    }
}
