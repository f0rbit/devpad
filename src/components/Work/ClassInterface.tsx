"use client";

import { ParsedClass } from "@/types/page-link";
import { UniversityAssignment } from "@prisma/client";
import { Check, Cross, Pencil, Plus, Save, Trash, X } from "lucide-react";
import moment from "moment";
import { Dispatch, SetStateAction, useState } from "react";
import DeleteButton from "../common/DeleteButton";
import GenericButton from "../common/GenericButton";
import DatePicker from "react-datepicker";
import AcceptButton from "../common/AcceptButton";

export default function ClassInterface({ initial_class }: { initial_class: ParsedClass }) {
	const [data, setData] = useState(initial_class);

	return (
		<div>
			<AssignmentOverview data={data} setData={setData} />
			<div>Readings</div>
			<div>Work Todo</div>
		</div>
	);
}

export function AssignmentOverview({ data, setData }: { data: ParsedClass; setData?: Dispatch<SetStateAction<ParsedClass>> }) {
	const [editing, setEditing] = useState(false);

	function deleteAssignment(assignment: UniversityAssignment) {
		if (!setData) return;
		const id = assignment.assignment_id;

		setData((data) => ({
			...data,
			assignments: data.assignments.filter((a) => a.assignment_id !== id)
		}));
	}

	async function addAssignment(assignment: CreateAssignmentType): Promise<{ error: string | null }> {
		if (!setData) return { error: "No data setter provided." };
		const new_assignment: UniversityAssignment = {
			assignment_id: "new",
			class_id: data.class_id,
			created_at: new Date(),
			updated_at: new Date(),
			due_date: assignment.date,
			weight: assignment.weight ?? 0,
			name: assignment.name,
			description: assignment.description ?? "",
			result: null,
			finished_at: null,
			group: null,
			owner_id: data.owner_id,
			work_id: data.work_id
		};

		setData((data) => ({
			...data,
			assignments: [...data.assignments, new_assignment]
		}));

		return { error: null };
	}

	const { assignments } = data;

	return (
		<div className="relative my-2 mt-4 flex flex-col gap-4">
			<div className="flex flex-row justify-center gap-2">
				<h2 className="text-center text-2xl font-semibold text-base-text-primary">Assignments</h2>
				{setData && (
					<GenericButton style="absolute right-0" onClick={() => setEditing(!editing)}>
						{editing ? <Check className="w-5" /> : <Pencil className="w-5" />}
					</GenericButton>
				)}
			</div>
			<div className="flex flex-col gap-2 rounded-md border-1 border-borders-primary p-2 pb-2 pr-2">
				<Assignments assignments={assignments} deleteAssignment={editing && setData ? deleteAssignment : undefined} create={setData ? addAssignment : undefined} />
			</div>
		</div>
	);
}

export function Assignments({ assignments, deleteAssignment, create }: { assignments: UniversityAssignment[]; deleteAssignment?: (assignment: UniversityAssignment) => void; create?: (assignment: CreateAssignmentType) => Promise<{ error: string | null }> }) {
	async function createAssignment(data: CreateAssignmentType) {
		if (!create) return { error: "Create function not provided" };
		if (!data.weight || data.weight < 0 || data.weight > 1) {
			return { error: "Weight must be between 0 and 1" };
		}
		if (data.name.length < 1) {
			return { error: "Name must be at least 1 character long" };
		}
		if (!data.date) {
			return { error: "Date must be valid" };
		}

		// do the request
		const response = await create(data);
		return response;
	}

	return (
		<div className="flex flex-wrap justify-center gap-2 ">
			{assignments.map((assignment) => (
				<div className="relative w-full max-w-[30%] rounded-md border-1 border-borders-primary bg-base-accent-primary py-2 pl-2 pr-4">
					<div className="-mt-1 flex flex-col gap-0">
						<div className="flex flex-row items-center gap-2 text-lg font-medium text-base-text-secondary ">
							<span>{assignment.name}</span>
							<span className="text-sm text-base-text-dark">{assignment.weight * 100 + "%"}</span>
						</div>
						<div className="text-sm text-base-text-subtle">{assignment.description}</div>
					</div>
					<div>
						<div className="text-sm text-base-text-subtlish">{moment(assignment.due_date).calendar({ sameElse: "DD/MM/yyyy" })}</div>
					</div>
					{deleteAssignment && (
						<DeleteButton style="absolute right-[-2px] scale-75 bottom-[1px] flex justify-center items-center" onClick={() => deleteAssignment(assignment)}>
							<Trash className="w-5" />
						</DeleteButton>
					)}
				</div>
			))}
			{deleteAssignment && <AssignmentCreator create={createAssignment} />}
		</div>
	);
}
type CreateAssignmentType = {
	name: string;
	description: string;
	weight: number | null;
	date: Date;
};

function AssignmentCreator({ create }: { create: (assignment: CreateAssignmentType) => Promise<{ error: string | null }> }) {
	const [open, setOpen] = useState(false);
	const [item, setItem] = useState<CreateAssignmentType>({ name: "", description: "", weight: null, date: new Date() });
	const [error, setError] = useState(null as string | null);

	function close() {
		setItem({ name: "", description: "", weight: null, date: new Date() });
		setOpen(false);
	}

	if (!open) {
		return (
			<GenericButton onClick={() => setOpen(true)} style="max-w-[30%] w-full">
				<Plus className="mx-auto text-base-text-subtle" />
			</GenericButton>
		);
	}
	return (
		<div className="styled-input relative w-full max-w-[30%] rounded-md border-1 border-borders-primary bg-base-accent-primary py-2 pl-2 pr-4 text-sm">
			<div className="flex flex-col gap-1">
				<div className="flex flex-row items-center gap-2">
					<label htmlFor="name" className="text-base-text-subtle">
						Name
					</label>
					<input type="text" name="name" id="name" className="text-base-text-secondary" autoComplete="off" value={item.name} onChange={(e) => setItem((item) => ({ ...item, name: e.target.value }))} />
				</div>
				<div className="flex flex-row items-center gap-2">
					<label htmlFor="description" className="text-base-text-subtle">
						Description
					</label>
					<input type="text" name="description" id="description" className="text-base-text-subtlish" autoComplete="off" value={item.description} onChange={(e) => setItem((item) => ({ ...item, description: e.target.value }))} />
				</div>
				<div className="flex flex-row items-center gap-2">
					<label htmlFor="due_date" className="whitespace-nowrap text-base-text-subtle">
						Date
					</label>
					<DatePicker
						wrapperClassName="devpad-date"
						className="scrollbar-hide text-base-text-subtlish"
						showTimeSelect
						selected={item.date ? new Date(item.date) : null}
						onChange={(date) => {
							setItem((item) => ({ ...item, date: date as Date }));
						}}
						timeFormat="h:mm aa"
						dateFormat={"MMMM d, yyyy h:mm aa"}
					/>
					<label htmlFor="weight" className="text-base-text-subtle">
						Weight
					</label>
					<input
						type="number"
						step="0.01"
						name="weight"
						id="weight"
						max="1"
						min="0"
						className="arrows-hide max-w-[60px] text-base-text-subtlish"
						autoComplete="off"
						value={item.weight ?? undefined}
						onChange={(e) => setItem((item) => ({ ...item, weight: parseFloat(e.target.value) }))}
					/>
				</div>
				{error && <div className="text-center font-semibold text-red-400">{error}</div>}
				<div className="flex flex-row items-center justify-center gap-2">
					<GenericButton onClick={close} style="pb-0 pt-0 px-4">
						<X className="w-4" />
					</GenericButton>
					<AcceptButton
						onClick={async () => {
							const { error } = await create(item);
							if (error) {
								setError(error);
								setTimeout(() => setError(null), 3000);
							} else {
								close();
							}
						}}
						style="pb-0 pt-0 px-4"
					>
						<Save className="w-4" />
					</AcceptButton>
				</div>
			</div>
		</div>
	);
}
