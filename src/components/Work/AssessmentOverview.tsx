"use client";
import { AssessmentWeights, assessmentWeightValidator, ParsedClass } from "@/types/page-link";
import { UniversityClass } from "@prisma/client";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import GenericButton from "../common/GenericButton";

/** @todo get assessments weights somehow from the class */

export default function AssessmentOverview({ university_class }: { university_class: ParsedClass }) {
	const [data, setData] = useState(university_class);
	const [expanded, setExpanded] = useState(false);

	const weights = data.weights;

	if (!weights) {
		return <div>Invalid Schedule</div>;
	}

	return (
		<div className="flex flex-col items-center justify-center gap-2">
			<GenericButton onClick={() => setExpanded((expanded) => !expanded)} style="w-max flex flex-row gap-2 items-center">
				{expanded ? <ChevronDown /> : <ChevronRight />} Assessment Overview
			</GenericButton>
			{expanded && (
				<div className="w-full rounded-md border-1 border-borders-primary p-4">
					<div>
						<div className="flex flex-col justify-center gap-2">
							<AssessmentWeightLinebar weights={weights} className="mb-2" />
							<div className="flex flex-col rounded-md border-1 border-borders-secondary text-center">
								{/* table of weights */}
								<div className="mb-1 grid grid-cols-3 border-b-1 border-b-borders-primary p-1 text-xl font-medium text-base-text-secondary">
									<h4>Assessment Type</h4>
									<h4>Weight</h4>
									<h4>Hurdle</h4>
								</div>
								{weights.map((weight) => (
									<div className="grid grid-cols-3 p-0.5 text-base-text-subtlish">
										<div>{weight.name}</div>
										<div>{weight.weight * 100 + "%"}</div>
										<div>{weight.hurdle ? "Yes" : "No"}</div>
									</div>
								))}
								<div className="h-1"></div>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function AssessmentWeightLinebar({ weights, className }: { weights: AssessmentWeights; className?: string }) {
	return (
		<div className={"flex flex-row gap-1 " + className}>
			{weights?.map((weight) => (
				<div
					className="h-max rounded-sm px-2 "
					style={{
						backgroundColor: weight.hurdle ? "#755cdd" : "#9355d9",
						width: weight.weight * 100 + "%"
					}}
					title={weight.name + " " + weight.weight * 100 + "%"}
				>
					<div className="truncate text-center text-sm drop-shadow-md">{weight.name + " " + weight.weight * 100 + "%"}</div>
				</div>
			))}
		</div>
	);
}
