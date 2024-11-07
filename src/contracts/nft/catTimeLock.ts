import {
    ByteString,
    PubKey,
    Sig,
    SmartContract,
    assert,
    method,
    prop,
} from 'scrypt-ts'

export class CATTimeLock extends SmartContract {
    @prop()
    pubkey1: PubKey

    @prop()
    pubkey2: PubKey

    @prop()
    nonce: ByteString

    @prop()
    lockedBlocks: bigint

    constructor(
        pubkey1: PubKey,
        pubkey2: PubKey,
        nonce: ByteString,
        lockedBlocks: bigint
    ) {
        super(...arguments)
        this.pubkey1 = pubkey1
        this.pubkey2 = pubkey2
        this.nonce = nonce
        this.lockedBlocks = lockedBlocks
    }

    @method()
    public unlock(sig: Sig) {
        this.csv(this.lockedBlocks)
        assert(this.checkMultiSig([sig], [this.pubkey1, this.pubkey2]))
    }

    @method()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private csv(lockedBlocks: bigint): void {
        // ... Gets substituted for OP_CSV w/ inline assembly hook
        // TODO: Rm once OP_CSV is added to compiler.
        assert(true)
    }
}
