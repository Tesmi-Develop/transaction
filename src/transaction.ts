import Signal from "@rbxts/signal";

type RepeatingCallback = () => Promise<void | RepeatingCallback | { repeats: number; callback: RepeatingCallback }>;

export interface ITransactEntity {
	Init(): void;
	Transact(): ReturnType<RepeatingCallback>;
	Rollback(): ReturnType<RepeatingCallback>;
	End(): void;
}

export interface ITransactionConfig {
	TransactionRepeats: number;
	RollbackRepeats: number;
	RetryRate: number;
}

type ITransactionReport<T extends TransactionStatusCode> = T extends TransactionStatusCode.Success
	? {
			StatusCodes: T;
		}
	: {
			StatusCodes: T;
			Message: string;
		};
const DEFAULT_CONFIG: ITransactionConfig = {
	TransactionRepeats: 5,
	RollbackRepeats: 5,
	RetryRate: 1,
};

type States = "Waiting" | "Transact" | "Rollback";

export enum TransactionStatusCode {
	Success = "Success",
	TransactionFail = "TransactionFail",
	RollbackFail = "RollbackFail",
}

const DoSuccessReport = () =>
	({
		StatusCode: TransactionStatusCode.Success,
	}) as TransactionReport;

const DoFailReport = <T extends TransactionStatusCode.TransactionFail | TransactionStatusCode.RollbackFail>(
	statusCodes: T,
	message: string,
) =>
	({
		StatusCode: statusCodes,
		Message: message,
	}) as TransactionReport;

export type TransactionReport =
	| { StatusCode: TransactionStatusCode.Success }
	| { StatusCode: TransactionStatusCode.TransactionFail; Message: string }
	| { StatusCode: TransactionStatusCode.RollbackFail; Message: string };

export type TransactionFailReport = {
	StatusCode: TransactionStatusCode.TransactionFail | TransactionStatusCode.RollbackFail;
	Message: string;
};

export class Transaction {
	public readonly Ended = new Signal<(report: TransactionReport) => void>();
	private config: ITransactionConfig;
	private entities: ITransactEntity[] = [];
	private state: States = "Waiting";
	private transactionPromise: Promise<TransactionReport> | undefined;

	constructor(entities: ITransactEntity[], config?: Partial<ITransactionConfig>) {
		this.entities = entities;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	private setState(state: States) {
		this.state = state;
	}

	private isState(state: States) {
		return this.state === state;
	}

	private initEntities() {
		this.entities.forEach((entity) => entity.Init());
	}

	private endTransact() {
		this.entities.forEach((entity) => entity.End());
	}

	private async processAction(entity: ITransactEntity, action: "Transact" | "Rollback") {
		let callback: RepeatingCallback | undefined =
			action === "Transact" ? () => entity.Transact() : () => entity.Rollback();
		let countRepeats = action === "Transact" ? this.config.TransactionRepeats : this.config.RollbackRepeats;
		let message: unknown = "Action failed";

		while (callback) {
			let flag = false;

			for (const i of $range(1, math.max(countRepeats, 1))) {
				const [success, actionCallback] = callback!().await();
				if (!success) {
					task.wait(this.config.RetryRate);
					message = actionCallback; // write error
					continue;
				}

				flag = true;
				if (actionCallback === undefined) return;

				countRepeats = typeIs(actionCallback, "function")
					? this.config.TransactionRepeats
					: actionCallback.repeats;
				callback = typeIs(actionCallback, "function") ? actionCallback : actionCallback.callback;
				break;
			}

			if (!flag) break;
		}

		error(message);
	}

	private async processTransaction() {
		const completeTransactions: ITransactEntity[] = [];

		for (const entity of this.entities) {
			const [success, message] = this.processAction(entity, "Transact").await();
			completeTransactions.push(entity);

			if (!success) return [false, completeTransactions, message] as const;
		}

		return [true, completeTransactions] as const;
	}

	private async processRollback(entities: ITransactEntity[]) {
		let success = true;
		let message: unknown = "Rollback failed";

		for (const entity of entities) {
			const [successRollback, returned] = this.processAction(entity, "Rollback").await();

			if (!successRollback && success) {
				message = returned;
				success = false;
			}
		}

		return [success, message];
	}

	private async transact() {
		this.setState("Transact");
		this.initEntities();

		let code = TransactionStatusCode.Success;
		const [success, completeTransactions, message] = await this.processTransaction();
		let finalMessage = message;

		if (!success && this.isState("Transact")) {
			code = TransactionStatusCode.TransactionFail;

			this.setState("Rollback");
			const [successRollback, returned] = this.processRollback(completeTransactions).expect();

			if (!successRollback) {
				code = TransactionStatusCode.RollbackFail;
				finalMessage = returned;
			}
		}

		this.endTransact();
		this.transactionPromise = undefined;
		this.setState("Waiting");

		const report = success ? DoSuccessReport() : DoFailReport(code as never, finalMessage as string);
		this.Ended.Fire(report);

		return report;
	}

	public Transact() {
		if (this.state !== "Waiting") return this.transactionPromise!;

		this.transactionPromise = this.transact();
		return this.transactionPromise;
	}

	public Destroy() {
		this.transactionPromise?.cancel();
		this.Ended.Destroy();
	}
}
