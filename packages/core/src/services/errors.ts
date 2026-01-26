export type ServiceError =
	| { kind: "not_found"; entity: string; id: string }
	| { kind: "unauthorized"; message: string }
	| { kind: "database_error"; message: string }
	| { kind: "validation_error"; message: string }
	| { kind: "github_error"; message: string }
	| { kind: "scan_error"; message: string };
