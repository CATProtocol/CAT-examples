import {
    AddressType,
    CatPsbt,
    DefaultSigner,
    MempolChainProvider,
    MempoolUtxoProvider,
    bitcoinjs,
    hexToUint8Array,
} from '@cat-protocol/cat-sdk'
import * as ecc from '@bitcoinerlab/secp256k1'
import ECPairFactory from 'ecpair'
import { Psbt, initEccLib } from 'bitcoinjs-lib'
import * as dotenv from 'dotenv'
import { PubKey, hash160 } from 'scrypt-ts'
import { OracleLib } from '../../../../src/contracts/oracle/oracleLib'
import { OraclePriceStateProto } from '../../../../src/contracts/oracle/examples/priceProto'
import axios from 'axios'
import { assert } from 'console'
import { DexUsePriceCovenant } from '../../../../src/covenants/oracle/dexUsePriceCovenant'
import { DexUsePrice } from '../../../../src/contracts/oracle/examples/dexUsePrice'
dotenv.config()

const ECPair = ECPairFactory(ecc)
initEccLib(ecc)

const getUtxoFromPsbt = (self: Psbt, outputIndex: number) => {
    if (!self.txOutputs[outputIndex]) {
        throw new Error(`Output at index ${outputIndex} is not found`)
    }
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        txId: (self as any).__CACHE.__TX.getId(),
        outputIndex: outputIndex,
        script: Buffer.from(self.txOutputs[outputIndex].script).toString('hex'),
        satoshis: Number(self.txOutputs[outputIndex].value),
    }
}

const main = async function () {
    DexUsePrice.loadArtifact()
    const wif = process.env.PRIVATE_KEY!
    const userSigner = new DefaultSigner(ECPair.fromWIF(wif), AddressType.P2TR)
    const userPubkey = await userSigner.getPublicKey()
    const oracleServiceInfo = await axios.get('https://oracle.scrypt.io/info')
    const servicePubkey = oracleServiceInfo.data.publicKey
    const utxoProvider = new MempoolUtxoProvider('fractal-testnet')
    const chainProvider = new MempolChainProvider('fractal-testnet')
    const userUtxos = await utxoProvider.getUtxos(await userSigner.getAddress())
    if (userUtxos.length == 0) {
        console.log(
            `Please https://fractal-testnet.unisat.io/explorer/faucet get testnet coin ${await userSigner.getAddress()}`
        )
        return
    }
    const feeRate = 1
    const url = 'https://oracle.scrypt.io/v1/price'
    const dexUsePriceCovenant = new DexUsePriceCovenant(PubKey(servicePubkey))
    const data = {
        utxos: userUtxos.slice(0, 6),
        publicKey: userPubkey,
        feeRate: feeRate,
        tradingPair: 'BTC_USDT',
        lockedSatoshis: 546,
        otherOutputs: [
            {
                script: dexUsePriceCovenant.lockingScriptHex,
                satoshis: 330,
            },
        ],
    }
    const resp = await axios.post(url, data)
    const payloads = resp.data.data
    // field
    const maker = BigInt(payloads[0].value)
    const timestamp = BigInt(payloads[1].value)
    const price = BigInt(payloads[2].value)
    const decimals = BigInt(payloads[3].value)
    const tradingPair = payloads[4].value
    const oraclePriceState = OraclePriceStateProto.create(
        maker,
        timestamp,
        price,
        decimals,
        tradingPair
    )
    assert(
        OraclePriceStateProto.toByteString(oraclePriceState) ==
            resp.data.serializedData
    )
    // const dexUseTimestampCovenant = new DexUseTimestampCovenant()
    const payload = resp.data.serializedData
    const oracleCommitPsbt = Psbt.fromHex(resp.data.commitPsbt)
    const oracleRevealPsbt = Psbt.fromHex(resp.data.revealPsbt)
    // service response
    // how user use oracle
    {
        const size = 4000
        const oracleRedeemScript = OracleLib.buildOracleRedeemScript(
            hash160(payload),
            PubKey(servicePubkey),
            PubKey(userPubkey)
        )
        const oracleUtxo = getUtxoFromPsbt(oracleCommitPsbt, 1)
        const dexUsePriceCovenantUtxo = getUtxoFromPsbt(oracleCommitPsbt, 2)
        dexUsePriceCovenant.bindToUtxo(dexUsePriceCovenantUtxo)
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
                    const sig = input.partialSig![0]
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
        useOraclePsbt.addCovenantInput(dexUsePriceCovenant)
        useOraclePsbt.addFeeInputs([
            getUtxoFromPsbt(
                oracleCommitPsbt,
                oracleCommitPsbt.txOutputs.length - 1
            ),
        ])
        useOraclePsbt.change(await userSigner.getAddress(), feeRate, size)

        const inputCtxs = useOraclePsbt.calculateInputCtxs()
        useOraclePsbt.updateCovenantInput(
            1,
            dexUsePriceCovenant,
            dexUsePriceCovenant.unlock(
                1,
                inputCtxs,
                oraclePriceState,
                PubKey(userPubkey),
                0n
            )
        )
        const [signedOracleCommitPsbt, signedUseOraclePsbt] =
            await userSigner.signPsbts([
                {
                    psbtHex: oracleCommitPsbt.toHex(),
                    options: resp.data.commitOptions,
                },
                {
                    psbtHex: useOraclePsbt.toHex(),
                    options: useOraclePsbt.psbtOptions(),
                },
            ])
        const oracleCommitTx = await Psbt.fromHex(
            signedOracleCommitPsbt
        ).finalizeAllInputs()
        const useOracleTx = await useOraclePsbt
            .combine(Psbt.fromHex(signedUseOraclePsbt))
            .finalizeAllInputsAsync()
        console.log(
            'commit:',
            await chainProvider.broadcast(
                oracleCommitTx.extractTransaction().toHex()
            )
        )
        console.log(
            'reveal:',
            await chainProvider.broadcast(
                useOracleTx.extractTransaction().toHex()
            )
        )
    }
}

main()
