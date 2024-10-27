
interface Props {
	task: any;
	project: any;
	from: string;
}

export const TaskCard = (props: Props) => {
	const { task: fetched_task, project, from } = props;
	const { task } = fetched_task;

	return (
		<div>
			<div>
				<span class="lowercase">{task.progress}</span> - <span><a href={`/todo/${task.id}?from=${from}`}>{task.title}</a></span>
			</div>
			<div>
				<span>{project?.name}</span>, <span class="lowercase">{task.priority} priority</span>
			</div>
			<style>
				{`
					.lowercase {
						text-transform: lowercase;
					}
				`}
			</style>
		</div>
	);
};