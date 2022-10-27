import { signIn } from "next-auth/react";
import { Github } from "lucide-react";

export default function LoginButton() {
	return (
		<button
			className="flex w-full flex-row items-center justify-center gap-2 rounded-lg bg-[#2d333b] px-3 py-2 text-center font-bold text-white drop-shadow-lg transition-all duration-300 hover:scale-105 hover:bg-[#22272e]"
			onClick={(e) => {
				e.preventDefault();
				signIn("github");
			}}
		>
			<Github />
			Login
		</button>
	);
}
