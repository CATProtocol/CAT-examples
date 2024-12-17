import {
    ByteString,
    PubKey,
    SmartContractLib,
    int2ByteString,
    len,
    method,
    sha256,
    toByteString,
} from 'scrypt-ts'

export class OracleLib extends SmartContractLib {
    @method()
    static buildOracleRedeemScript(
        payloadHash: ByteString,
        oracleKey: PubKey,
        publickey: PubKey
    ): ByteString {
        // exec in legacy bvm runtime, ecdsa sig
        // <oracleKey><payload><publickey>54795379ad537978ac6b6d6d6c77
        return (
            toByteString('21') +
            oracleKey +
            int2ByteString(len(payloadHash)) +
            payloadHash +
            toByteString('21') +
            publickey +
            // artifacts/contracts/oracle/oracle.json L46, Oracles artifact file.
            toByteString('54795379ad537978ac6b6d6d6c77')
        )
    }

    @method()
    static buildP2wshLockingScript(redeemScript: ByteString): ByteString {
        return toByteString('0020') + sha256(redeemScript)
    }

    @method()
    static buildOracleP2wsh(
        payloadHash: ByteString,
        oracleKey: PubKey,
        publickey: PubKey
    ): ByteString {
        return OracleLib.buildP2wshLockingScript(
            OracleLib.buildOracleRedeemScript(payloadHash, oracleKey, publickey)
        )
    }
}
