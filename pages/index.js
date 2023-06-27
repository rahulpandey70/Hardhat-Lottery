import Head from "next/head"
import styles from "../styles/Home.module.css"
import Header1 from "../components/Header1"
import LotteryEntrance from "../components/LotteryEntrance"

export default function Home() {
    return (
        <div className={styles.container}>
            <Head>
                <title>Smart Contract Lottery</title>
                <meta name="description" content="Our Smart Contract" />
                <link rel="icon" href="/favicon.ico" />
            </Head>
            <Header1 />
            <LotteryEntrance />
        </div>
    )
}
