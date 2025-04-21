import {
    CAT20Covenant,
    CAT20GuardCovenant,
    CAT20Guard,
    CAT20,
    emptyOutputByteStrings,
} from '@cat-protocol/cat-sdk-v2'
import {
    ByteString,
    FixedArray,
    Int32,
    STATE_OUTPUT_COUNT_MAX,
    TX_INPUT_COUNT_MAX,
} from '@scrypt-inc/scrypt-ts-btc'

export function createTransferGuard(
    inputInfos: {
        token: CAT20Covenant
        inputIndex: number
    }[],
    receivers: {
        address: ByteString
        amount: Int32
        outputIndex: number
    }[],
    changeInfo?: {
        address: ByteString
    }
): {
    guard: CAT20GuardCovenant
    outputTokens: FixedArray<
        CAT20Covenant | undefined,
        typeof STATE_OUTPUT_COUNT_MAX
    >
    changeTokenOutputIndex: number
} {
    if (inputInfos.length === 0) {
        throw new Error('No spent tokens')
    }

    if (inputInfos.length > TX_INPUT_COUNT_MAX - 1) {
        throw new Error(
            `Too many token inputs that exceed the maximum limit of ${TX_INPUT_COUNT_MAX}`
        )
    }

    const totalTokenInputAmount = inputInfos.reduce((acc, info) => {
        if (!info.token.state) {
            throw new Error('Token state is missing')
        }
        return acc + info.token.state.amount
    }, 0n)

    const totalTokenOutputAmount = receivers.reduce(
        (acc, receiver) => acc + receiver.amount,
        0n
    )

    if (totalTokenInputAmount < totalTokenOutputAmount) {
        throw new Error('Insufficient token input amount')
    }

    if (totalTokenInputAmount > totalTokenOutputAmount && !changeInfo) {
        throw new Error(
            'Unbalanced token output amount, change address is missing'
        )
    }

    const changeTokenAmount = totalTokenInputAmount - totalTokenOutputAmount
    let changeTokenOutputIndex = -1
    if (changeTokenAmount > 0) {
        changeTokenOutputIndex = receivers.length + 1
    }

    const minterAddr = inputInfos[0].token.minterAddr
    const guardState = CAT20Guard.createEmptyState()
    guardState.tokenScripts[0] = inputInfos[0].token.lockingScriptHex
    for (let index = 0; index < inputInfos.length; index++) {
        const inputInfo = inputInfos[index]
        guardState.tokenScriptIndexes[inputInfo.inputIndex] = 0n
        guardState.inputStateHashes[inputInfo.inputIndex] = CAT20.stateHash(
            inputInfos[index].token.state
        )
    }
    guardState.tokenAmounts[0] = inputInfos.reduce(
        (p, c) => p + c.token.state.amount,
        0n
    )
    const guard = new CAT20GuardCovenant(guardState)
    const outputTokens = emptyOutputByteStrings().map((_, index) => {
        const receiver = receivers.find((r) => r.outputIndex === index + 1)
        if (receiver) {
            if (receiver.amount <= 0) {
                throw new Error(
                    `Invalid token amount ${receiver.amount} for output ${
                        index + 1
                    }`
                )
            }
            return new CAT20Covenant(minterAddr, {
                amount: receiver.amount,
                ownerAddr: receiver.address,
            })
        } else if (
            changeTokenAmount > 0 &&
            index + 1 === changeTokenOutputIndex
        ) {
            return new CAT20Covenant(minterAddr, {
                amount: changeTokenAmount,
                ownerAddr: changeInfo.address,
            })
        } else {
            return undefined
        }
    }) as FixedArray<CAT20Covenant | undefined, typeof STATE_OUTPUT_COUNT_MAX>
    return {
        guard,
        outputTokens,
        changeTokenOutputIndex,
    }
}
