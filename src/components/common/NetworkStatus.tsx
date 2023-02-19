import { LoadingStatus } from "@/types/page-link";
import { AlertCircle, AlertTriangle, Check, Cross, X } from "lucide-react";
import { useState } from "react";
import GenericModal from "../GenericModal";
import ErrorWrapper from "./ErrorWrapper";
import { LoadingSpinner } from "./LoadingSpinner";

export default function NetworkStatus({ status }: { status?: LoadingStatus }) {
	const [open, setOpen] = useState(false);
	if (!status) return <></>;
	const { error, loading } = status;
	return (
		<>
			<div className="fixed">
				<GenericModal open={open} setOpen={setOpen}>
					<ErrorWrapper message={error} />
				</GenericModal>
			</div>
			<div className="flex h-8 w-8 items-center justify-center">
				{error?.length > 0 ? (
					<button onClick={() => setOpen(true)} title="Sync Error">
						<AlertCircle className="h-4 w-4 text-red-300" />
					</button>
				) : loading ? (
					<div title="Syncing...">
						<LoadingSpinner className="h-4 w-4 fill-blue-300 opacity-50" />
					</div>
				) : (
					<div title="Synced!">
					<Check className="h-4 w-4 text-green-200" />
					</div>
				)}
			</div>
		</>
	);
}
