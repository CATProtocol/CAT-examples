import {
    ByteString,
    PubKey,
    Sig,
    SmartContract,
    assert,
    method,
    prop,
} from 'scrypt-ts'

export class Oracle extends SmartContract {
    @prop()
    oracleKey: PubKey

    @prop()
    payload: ByteString

    @prop()
    publickey: PubKey

    constructor(oracleKey: PubKey, payload: ByteString, publickey: PubKey) {
        super(...arguments)
        this.oracleKey = oracleKey
        // payload data less than 520
        this.payload = payload
        this.publickey = publickey
    }

    @method()
    public unlock(oracleSig: Sig, sig: Sig) {
        // check oracle sig
        assert(this.checkSig(oracleSig, this.oracleKey))
        // check spend sig
        assert(this.checkSig(sig, this.publickey))
    }
}
