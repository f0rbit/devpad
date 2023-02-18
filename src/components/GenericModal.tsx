import { Dialog, Transition } from "@headlessui/react";
import { Dispatch, Fragment, ReactNode, SetStateAction } from "react";

function GenericModal({ children, open, setOpen }: { children: ReactNode; open: boolean; setOpen: Dispatch<SetStateAction<boolean>> }) {
	return (
		<div>
			{open && <div className="fixed top-0 left-0 z-50 h-screen w-screen bg-black/75"></div>}
			<Transition
				show={open}
				enter="transition duration-300 ease-out"
				enterFrom="transform scale-95 opacity-0"
				enterTo="transform scale-100 opacity-100"
				leave="transition duration-75 ease-out"
				leaveFrom="transform scale-100 opacity-100"
				leaveTo="transform scale-95 opacity-0"
				as={Fragment}
			>
				<Dialog onClose={() => setOpen(false)} className="fixed top-0 z-50 h-screen w-screen bg-transparent" aria-hidden={true}>
					<div className="relative inset-0 flex h-full w-full items-center  justify-center p-4">
						<Dialog.Panel className="z-51 w-max rounded-md dark:bg-base-bg-primary bg-gray-100 p-4">{children}</Dialog.Panel>
					</div>
				</Dialog>
			</Transition>
		</div>
	);
}

export default GenericModal;
