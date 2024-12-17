import {
    AddressType,
    CatPsbt,
    DefaultSigner,
    MempolChainProvider,
    MempoolUtxoProvider,
    bitcoinjs,
    hexToUint8Array,
    uint8ArrayToHex,
} from '@cat-protocol/cat-sdk'
import * as ecc from '@bitcoinerlab/secp256k1'
import ECPairFactory from 'ecpair'
import { Psbt, initEccLib, payments } from 'bitcoinjs-lib'
import { signData } from '../../../../src/features/oracle/signData'
import * as dotenv from 'dotenv'
import { PubKey, hash160, toByteString } from 'scrypt-ts'
import { OracleLib } from '../../../../src/contracts/oracle/oracleLib'
dotenv.config()

const ECPair = ECPairFactory(ecc)
initEccLib(ecc)

const main = async function () {
    const wif = process.env.PRIVATE_KEY!
    const wif2 = process.env.PRIVATE_KEY2!
    const serviceSigner = new DefaultSigner(
        ECPair.fromWIF(wif),
        AddressType.P2TR
    )
    const userSigner = new DefaultSigner(ECPair.fromWIF(wif2), AddressType.P2TR)
    const userSignerPayment = payments.p2tr({
        address: await userSigner.getAddress(),
    })
    const userPubkey = await userSigner.getPublicKey()
    const servicePubkey = await serviceSigner.getPublicKey()
    const utxoProvider = new MempoolUtxoProvider('fractal-testnet')
    const chainProvider = new MempolChainProvider('fractal-testnet')
    const userUtxos = await utxoProvider.getUtxos(await userSigner.getAddress())
    const feeRate = 1
    const serviceFee = 1000n
    const payload = toByteString('hello oracle', true)
    // service response
    const { oracleCommitPsbt, oracleRevealPsbt } = await signData(
        serviceSigner,
        userUtxos,
        userPubkey,
        toByteString('hello oracle', true),
        feeRate,
        1000,
        await serviceSigner.getAddress(),
        serviceFee,
        [
            {
                script: uint8ArrayToHex(userSignerPayment.output!),
                satoshis: 10000,
            },
            {
                script: uint8ArrayToHex(userSignerPayment.output!),
                satoshis: 10000,
            },
        ]
    )
    // how user use oracle
    {
        const size = 2000
        const oracleRedeemScript = OracleLib.buildOracleRedeemScript(
            hash160(payload),
            PubKey(servicePubkey),
            PubKey(userPubkey)
        )
        const oracleUtxo = oracleCommitPsbt.getUtxo(1)
        const useOraclePsbt = new CatPsbt()
        useOraclePsbt.addInput({
            hash: oracleUtxo.txId,
            index: oracleUtxo.outputIndex,
            witnessScript: hexToUint8Array(oracleRedeemScript),
            sighashType: bitcoinjs.Transaction.SIGHASH_ALL,
            witnessUtxo: {
                value: BigInt(oracleUtxo.satoshis),
                script: hexToUint8Array(oracleUtxo.script),
            },
            finalizer: (self, inputIndex, input) => {
                if (input.partialSig) {
                    const oracleSig =
                        oracleRevealPsbt.data.inputs[0].partialSig![0]
                    const sig = input.partialSig.find(
                        (value) => uint8ArrayToHex(value.pubkey) == userPubkey
                    )
                    if (oracleSig && sig && input.witnessScript) {
                        return [
                            Buffer.from(oracleSig.signature),
                            Buffer.from(sig.signature),
                            Buffer.from(input.witnessScript),
                        ]
                    }
                }
                return []
            },
            sigRequests: [
                {
                    inputIndex: 0,
                    options: {
                        address: await userSigner.getAddress(),
                        sighashTypes: [bitcoinjs.Transaction.SIGHASH_ALL],
                    },
                },
            ],
        })
        useOraclePsbt.addFeeInputs([oracleCommitPsbt.getUtxo(3)])
        useOraclePsbt.change(await userSigner.getAddress(), feeRate, size)
        const [signedOracleCommitPsbt, signedUseOraclePsbt] =
            await userSigner.signPsbts([
                {
                    psbtHex: oracleCommitPsbt.toHex(),
                    options: oracleCommitPsbt.psbtOptions(),
                },
                {
                    psbtHex: useOraclePsbt.toHex(),
                    options: useOraclePsbt.psbtOptions(),
                },
            ])
        const oracleCommitTx = await oracleCommitPsbt
            .combine(Psbt.fromHex(signedOracleCommitPsbt))
            .finalizeAllInputsAsync()
        const useOracleTx = await useOraclePsbt
            .combine(Psbt.fromHex(signedUseOraclePsbt))
            .finalizeAllInputsAsync()
        console.log(
            await chainProvider.broadcast(
                oracleCommitTx.extractTransaction().toHex()
            )
        )
        console.log(
            await chainProvider.broadcast(
                useOracleTx.extractTransaction().toHex()
            )
        )
    }
}

main()
