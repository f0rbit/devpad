import { Fragment, useContext, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { LoginContext } from "src/pages/_app";
import { Github } from "lucide-react"
import LoginButton from "./LoginButton";

function LoginDialog() {
    const { loginOpen, setLoginOpen } = useContext(LoginContext);

    return (
        <Transition
            show={loginOpen}
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
            as={Fragment}
        >
            <Dialog
                onClose={() => setLoginOpen(false)}
                className="fixed top-0 z-50 h-screen w-screen bg-black/80"
                aria-hidden={true}
            >
                <div className="relative inset-0 flex items-center justify-center p-4  w-full h-full">
                    <Dialog.Panel className="w-96 bg-pad-gray-700 p-4 rounded-md">
                        <Dialog.Title className="text-center text-3xl font-bold">Login</Dialog.Title>
                        <div className="flex justify-center flex-col px-16">
                            <br />
                        <LoginButton />
                        <br />
                        <button onClick={() => setLoginOpen(false)} className="bg-[#fa7d7d] text-red-50 shadow-md hover:bg-[#db6767] px-3 py-2 rounded-md font-bold drop-shadow-lg">
                            Cancel
                        </button>
                        </div>
                        
                    </Dialog.Panel>
                </div>
            </Dialog>
        </Transition>
    );
}

export default LoginDialog;
