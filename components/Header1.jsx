import { ConnectButton } from "web3uikit"

export default function Header1() {
    return (
        <div>
            Decentralized Lottery
            <ConnectButton moralisAuth={false} />
        </div>
    )
}
