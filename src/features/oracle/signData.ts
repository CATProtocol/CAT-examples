import {
    CatPsbt,
    Signer,
    bitcoinjs,
    hexToUint8Array,
} from '@cat-protocol/cat-sdk'
import { ByteString, PubKey, UTXO, hash160 } from 'scrypt-ts'
import { OracleLib } from '../../contracts/oracle/oracleLib'
import { Psbt, address } from 'bitcoinjs-lib'

export type OtherOutputs = { script: string; satoshis: number }[]

export async function signData(
    oracleSigner: Signer,
    userUtxos: UTXO[],
    userPubkey: ByteString,
    payload: ByteString,
    feeRate: number,
    lockedSatoshis: number,
    serviceAddress: string,
    serviceFee: bigint,
    otherOutputs: OtherOutputs
) {
    const oracleServicePubkey = await oracleSigner.getPublicKey()
    const estCommitTxVsize = estimateCommitTxVSize(
        oracleServicePubkey,
        userUtxos,
        userPubkey,
        payload,
        feeRate,
        serviceAddress,
        serviceFee,
        otherOutputs
    )
    const tx = buildOracleCommitTx(
        oracleServicePubkey,
        userUtxos,
        userPubkey,
        payload,
        feeRate,
        lockedSatoshis,
        serviceAddress,
        serviceFee,
        otherOutputs,
        estCommitTxVsize
    )
    const oracleUtxo = tx.getUtxo(1)
    const oracleRevealPsbt = new CatPsbt()
    const oracleRedeemScript = OracleLib.buildOracleRedeemScript(
        hash160(payload),
        PubKey(oracleServicePubkey),
        PubKey(userPubkey)
    )
    oracleRevealPsbt.addInput({
        hash: oracleUtxo.txId,
        index: oracleUtxo.outputIndex,
        witnessScript: hexToUint8Array(oracleRedeemScript),
        sighashType:
            bitcoinjs.Transaction.SIGHASH_NONE |
            bitcoinjs.Transaction.SIGHASH_ANYONECANPAY,
        witnessUtxo: {
            value: BigInt(oracleUtxo.satoshis),
            script: hexToUint8Array(oracleUtxo.script),
        },
        sigRequests: [
            {
                inputIndex: 0,
                options: {
                    address: await oracleSigner.getAddress(),
                    sighashTypes: [
                        bitcoinjs.Transaction.SIGHASH_NONE |
                            bitcoinjs.Transaction.SIGHASH_ANYONECANPAY,
                    ],
                },
            },
        ],
    })
    const [signedOracleRevealPsbt] = await oracleSigner.signPsbts([
        {
            psbtHex: oracleRevealPsbt.toHex(),
            options: oracleRevealPsbt.psbtOptions(),
        },
    ])
    const oracleRevealTx = await oracleRevealPsbt.combine(
        Psbt.fromHex(signedOracleRevealPsbt)
    )
    return {
        oracleCommitPsbt: buildOracleCommitTx(
            oracleServicePubkey,
            userUtxos,
            userPubkey,
            payload,
            feeRate,
            lockedSatoshis,
            serviceAddress,
            serviceFee,
            otherOutputs,
            estCommitTxVsize
        ),
        oracleRevealPsbt: oracleRevealTx,
    }
}

export function estimateCommitTxVSize(
    pubkey: string,
    userUtxos: UTXO[],
    userPubkey: string,
    payload: ByteString,
    feeRate: number,
    serviceAddress: string,
    serviceFee: bigint,
    otherOutputs: OtherOutputs
) {
    return buildOracleCommitTx(
        pubkey,
        userUtxos,
        userPubkey,
        payload,
        feeRate,
        330,
        serviceAddress,
        serviceFee,
        otherOutputs
    ).estimateVSize()
}

export function buildOracleCommitTx(
    pubkey: string,
    userUtxos: UTXO[],
    userPubkey: string,
    payload: ByteString,
    feeRate: number,
    lockSatoshi: number,
    serviceAddress: string,
    serviceFee: bigint,
    otherOutputs: OtherOutputs,
    estimatedVSize?: number
) {
    const p2shLockingScript = OracleLib.buildOracleP2wsh(
        hash160(payload),
        PubKey(pubkey),
        PubKey(userPubkey)
    )
    const oracleCommitTx = new CatPsbt().addFeeInputs(userUtxos)
    oracleCommitTx.addOutput({
        script: hexToUint8Array(p2shLockingScript),
        value: BigInt(lockSatoshi),
    })
    for (const otherOutput of otherOutputs) {
        oracleCommitTx.addOutput({
            script: hexToUint8Array(otherOutput.script),
            value: BigInt(otherOutput.satoshis),
        })
    }
    oracleCommitTx.addOutput({
        address: serviceAddress,
        value: serviceFee,
    })
    oracleCommitTx.change(
        address.fromOutputScript(hexToUint8Array(userUtxos[0].script)),
        feeRate,
        estimatedVSize
    )
    return oracleCommitTx
}
