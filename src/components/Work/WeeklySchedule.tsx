"use client";
import { ScheduledClass } from "@/types/page-link";
import { AlignJustify, Table2 } from "lucide-react";
import moment from "moment";
import { useState } from "react";
import GenericButton from "../common/GenericButton";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

type OptionalClass = ScheduledClass & { class_id?: string; class_name?: string; class_department?: string; class_number?: string };

enum ViewMode {
	TABLE,
	LIST
}

function timeToMoment(time: string) {
	const [hour, minute] = time.split(":");
	if (!hour || !minute) return moment().zone("GMT");
	const m = moment().zone("GMT");
	m.hours(parseInt(hour));
	m.minutes(parseInt(minute));
	m.milliseconds(0);
	m.seconds(0);
	return m;
}

export default function WeeklySchedule({ classes }: { classes: OptionalClass[] }) {
	const [mode, setMode] = useState(ViewMode.TABLE);

	const ViewControls = () => {
		return (
			<div className="absolute top-0 right-0 flex flex-row gap-2">
				<GenericButton style="w-full" onClick={() => setMode(ViewMode.LIST)}>
					<AlignJustify />
				</GenericButton>
				<GenericButton style="w-full" onClick={() => setMode(ViewMode.TABLE)}>
					<Table2 />
				</GenericButton>
			</div>
		);
	};

	if (mode == ViewMode.TABLE) {
		const earliest_start_time = Math.min(
			classes.reduce((acc, c) => {
				const [hour, minute] = c.start_time.split(":");
				if (!hour || !minute) return acc;
				const start_time = parseInt(hour) + parseInt(minute) / 60;
				return Math.min(acc, start_time);
			}, 24),
			9
		);

		const latest_end_time = Math.max(
			classes.reduce((acc, c) => {
				const [hour, minute] = c.end_time.split(":");
				if (!hour || !minute) return acc;
				const end_time = parseInt(hour) + parseInt(minute) / 60;
				return Math.max(acc, end_time);
			}, 0),
			17
		);

		const hours = latest_end_time - earliest_start_time;

		const gridTemplateColumns = "10% 17.5% 17.5% 17.5% 17.5% 17.5%";
		// view mode table
		return (
			<div className="flex flex-col gap-1">
				<ViewControls />
				<div className="grid items-center text-center text-2xl font-medium text-base-text-subtlish" style={{ gridTemplateColumns }}>
					<div className="text-lg font-normal">Times</div>
					{days.map((day) => (
						<div key={day}>{day}</div>
					))}
				</div>
				<div className={"grid gap-x-1 "} style={{ gridAutoRows: "1fr", gridTemplateColumns }}>
					{
						// @ts-ignore
						[...Array(hours).keys()].map((i) => {
							// const time = moment().zone("GMT");
							// time.hours(earliest_start_time + i)
							// 	.minutes(0)
							// 	.seconds(0)
							// 	.milliseconds(0);
							const time = timeToMoment(`${earliest_start_time + i}:00`);

							return (
								<>
									<div key={i} className="flex items-center justify-center text-base-text-subtlish">
										{time.format("h:mm A")}
									</div>
									{days.map((day) => {
										return (
											<div key={day}>
												{classes
													.filter((c) => c.day === day && classAtTime(c, time))
													.map((c) => {
														return <ScheduledClassCard scheduled_class={c} begin={classIsBegin(c, time)} end={classIsEnd(c, time)} time={false} />;
													})}
											</div>
										);
									})}
								</>
							);
						})
					}
				</div>
			</div>
		);
	} else {
		// view mode list
		return (
			<div className="flex flex-col gap-2">
				<ViewControls />
				{days.map((day) => {
					const day_classes = classes.filter((c) => c.day === day).sort((a, b) => timeToMoment(a.start_time).diff(timeToMoment(b.start_time)));
					if (!day_classes.length) return null;
					return (
						<div key={day} className="flex flex-col gap-1">
							<div className="flex flex-row items-center gap-1">
								<div className="text-2xl font-medium text-base-text-subtlish">{day}</div>
							</div>
							{day_classes.map((c) => {
								return <ScheduledClassCard scheduled_class={c} begin={true} end={true} time={true} />;
							})}
						</div>
					);
				})}
			</div>
		);
	}
}

function ScheduledClassCard({ scheduled_class, begin, end, time }: { scheduled_class: OptionalClass; begin: boolean; end: boolean; time: boolean }) {
	let style = "";
	if (begin) {
		style += "rounded-tl-md rounded-tr-md border-t-1 ";
	}
	if (end) {
		style += "rounded-bl-md rounded-br-md border-b-1 ";
	}

	const ClassInformation = () => {
		// reference to the class information
		// const ref = useRef(null as HTMLDivElement | null);
		if (!scheduled_class.class_id) return null;

		// useEffect(() => {
		// 	// set the class information's max width to the size of the parent
		// 	// @ts-ignore
		// 	ref.current.style.maxWidth = ref.current.offsetWidth + "px";
		// 	// @ts-ignore
		// 	ref.current.children[2].style.display = "unset";
		// });

		return (
			<div className="flex w-full flex-row items-center gap-1 text-base-text-secondary">
				<div className="whitespace-nowrap font-semibold">{scheduled_class.class_department}</div>
				<div className="whitespace-nowrap font-semibold">{scheduled_class.class_number}</div>
				<div className="truncate text-base-text-subtlish">{scheduled_class.class_name}</div>
			</div>
		);
	};

	return (
		<div className={"h-full w-full " + (begin ? "pt-1" : "")}>
			<div className={"flex h-full w-full flex-col gap-1 border-x-1 border-borders-secondary bg-base-accent-primary py-1 px-2 text-sm text-base-text-subtlish " + style}>
				{begin && (
					<>
						<ClassInformation />
						<div className="">
							<span className="text-base font-medium capitalize text-base-text-secondary">{scheduled_class.type}</span>
							{scheduled_class.repeat !== "weekly" && <span className="text-base-text-subtle"> - {scheduled_class.repeat}</span>}
						</div>
						{time && (
							<div className="flex flex-row items-center gap-1 text-base-text-subtlish">
								<div>{timeToMoment(scheduled_class.start_time).format("h:mm A")}</div>
								<div>-</div>
								<div>{timeToMoment(scheduled_class.end_time).format("h:mm A")}</div>
							</div>
						)}
						<div>{scheduled_class.room}</div>
					</>
				)}
			</div>
		</div>
	);
}

function classIsBegin(c: ScheduledClass, time: moment.Moment) {
	// const [hour, minute] = c.start_time.split(":");
	// if (!hour || !minute) return false;
	// const start_time = moment().zone("GMT");
	// start_time.hours(parseInt(hour)).minutes(0).seconds(0).milliseconds(0);
	const start_time = timeToMoment(c.start_time);
	return start_time.isSame(time);
}

function classIsEnd(c: ScheduledClass, time: moment.Moment) {
	// const [hour, minute] = c.end_time.split(":");
	// if (!hour || !minute) return false;
	// const end_time = moment().zone("GMT");
	// end_time
	// 	.hours(parseInt(hour) - 1)
	// 	.minutes(parseInt(minute))
	// 	.seconds(0)
	// 	.milliseconds(0);

	const end_time = timeToMoment(c.end_time);
	end_time.hours(end_time.hours() - 1);

	return end_time.isSame(time);
}

function classAtTime(c: ScheduledClass, time: moment.Moment) {
	// const [start_hour, start_minute] = c.start_time.split(":");
	// const [end_hour, end_minute] = c.end_time.split(":");
	// if (!start_hour || !start_minute || !end_hour || !end_minute) return false;
	// const start_moment = moment().zone("GMT");
	// start_moment.hours(parseInt(start_hour)).minutes(parseInt(start_minute)).seconds(0).milliseconds(0);
	// const end_moment = moment().zone("GMT");
	// end_moment.hours(parseInt(end_hour)).minutes(parseInt(end_minute)).seconds(0).milliseconds(0);
	const start_moment = timeToMoment(c.start_time);
	const end_moment = timeToMoment(c.end_time);

	return start_moment.isSameOrBefore(time) && end_moment.isAfter(time);
}
