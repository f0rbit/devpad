export const dateToDateTime = (date: Date) => {
	return date
		.toLocaleString("sv-SE", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit"
		})
		.replace(" ", "T");
};

export const dateToDateAndTime = (date: Date) => {
	return (
		date.toLocaleDateString() +
		" " +
		date.toTimeString().split(" ")[0]?.substring(0, 5)
	);
};
