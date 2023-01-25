import { Prisma } from "@prisma/client";
import { JSONValue } from "superjson/dist/types";

type CheckListItem = {
	description: string;
	completed: string;
};

type DescriptionModuleObject = {
	text?: string;
	url?: string;
	items?: CheckListItem[];
};

export const DescriptionModule = ({ _key, object }: { _key: string; object: DescriptionModuleObject }) => {
	switch (_key) {
		case "markdown":
			return <span className="font-mono">{object["text"] ?? ""}</span>;
		case "image":
			return <img src={object["url"]} />;
		case "checklist":
			return (
				<div>
					{object["items"]?.map((item, index) => {
						return (
							<div key={index}>
								<input type="checkbox" defaultChecked={item["completed"] == "true" ? true : false} />
								<span>{item["description"]}</span>
							</div>
						);
					})}
				</div>
			);
		default:
			return <></>;
	}
};

const DescriptionItem = ({ object }: { object: Prisma.JsonObject }) => {
	// assume that the object has only one key
	const _key = Object.keys(object)[0];
	if (!_key) return <></>;
	const value = Object.values(object)[0];
	return <DescriptionModule _key={_key.toString()} object={value as DescriptionModuleObject} />;
};

const DescriptionParser = ({ description }: { description: Prisma.JsonObject[] }) => {
	return (
		<div className="grid grid-cols-1 gap-4">
			{Object.values(description).map((object, index) => {
				return <DescriptionItem key={index} object={object} />;
			})}
		</div>
	);
};

export default DescriptionParser;
