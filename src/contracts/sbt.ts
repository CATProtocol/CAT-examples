import {
    ChangeInfo,
    SHPreimage,
    SigHashUtils,
    StateUtils,
    TxUtil,
} from '@cat-protocol/cat-smartcontracts'
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
} from 'scrypt-ts'

export class SBT extends SmartContract {
    @prop()
    ownerPubkey: ByteString

    constructor(ownerPubkey: ByteString) {
        super(...arguments)
        this.ownerPubkey = ownerPubkey
    }

    @method()
    public burn(
        pubKeyPrefix: ByteString,
        ownerPubKey: PubKey,
        ownerSig: Sig,
        shPreimage: SHPreimage,
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
        // auth
        assert(pubKeyPrefix + ownerPubKey == this.ownerPubkey)
        assert(this.checkSig(ownerSig, ownerPubKey))
        // build outputs
        const stateOutput = TxUtil.buildOpReturnRoot(
            TxUtil.getStateScript(hash160(StateUtils.getPadding(0n)))
        )
        const changeOutput = TxUtil.getChangeOutput(changeInfo)
        const hashOutputs = sha256(stateOutput + changeOutput)
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
    }
}
