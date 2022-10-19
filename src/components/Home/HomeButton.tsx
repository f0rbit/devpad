import Link from 'next/link';

const HomeButton = ({ text, dest }: { text: string; dest: string }) => {
    return (
        <Link href={dest}>
            <a href={dest}>
                <button className="text-white origin-bottom rounded-md bg-pad-purple-500 px-4 py-2 font-bold shadow-md transition-all duration-300 hover:scale-110 hover:bg-pad-purple-700 hover:shadow-md hover:shadow-pad-purple-shadow">
                    {text}
                </button>
            </a>
        </Link>
    );
};

export default HomeButton;
