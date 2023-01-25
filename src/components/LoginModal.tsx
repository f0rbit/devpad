import { Dialog } from "@headlessui/react";
import { useContext } from "react";
import { LoginContext } from "src/pages/_app";
import GenericModal from "./GenericModal";
import LoginButton from "./LoginButton";

const LoginModal = () => {
	const { loginOpen, setLoginOpen } = useContext(LoginContext);
	return (
		<GenericModal open={loginOpen} setOpen={setLoginOpen}>
			<Dialog.Title className="text-center text-3xl font-bold">Login</Dialog.Title>
			<div className="flex w-96 flex-col justify-center px-16">
				<br />
				<LoginButton />
				<br />
				<button onClick={() => setLoginOpen(false)} className="rounded-md bg-[#fa7d7d] px-3 py-2 font-bold text-red-50 shadow-md drop-shadow-lg transition-all duration-300 hover:scale-105 hover:bg-[#db6767]">
					Cancel
				</button>
			</div>
		</GenericModal>
	);
};

export default LoginModal;
