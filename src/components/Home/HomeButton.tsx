import Link from "next/link";

const HomeButton = ({ text, dest }: { text: string; dest: string }) => {
    return (
        <Link href={dest}>
            <UnwrappedButton text={text} dest={dest} />
        </Link>
    );
};

export const UnwrappedButton = ({ text, dest }: { text: string; dest: string }) => {
    return (
        <a href={dest}>
            <button className="origin-bottom rounded-md bg-pad-purple-500 px-4 py-2 font-bold text-white shadow-md transition-all duration-300 hover:scale-110 hover:bg-pad-purple-700 hover:shadow-md hover:shadow-pad-purple-shadow">
                {text}
            </button>
        </a>
    );
};

export default HomeButton;
