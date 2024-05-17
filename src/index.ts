import Signal from "@rbxts/signal";

export interface ITransactEntity {
	Init(): void;
	Transact(): Promise<void>;
	Rollback(): Promise<void>;
	End(): void;
}

export interface ITransactionConfig {
	TransactionRepeats: number;
	RollbackRepeats: number;
	RetryRate: number;
}

interface IReport {
	Success: boolean;
	StatusCodes: TransactionStatusCode;
}

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

const DoSuccessReport = (): IReport => ({
	Success: true,
	StatusCodes: TransactionStatusCode.Success,
});

const DoFailReport = (statusCodes: TransactionStatusCode): IReport => ({
	Success: false,
	StatusCodes: statusCodes,
});

export class Transaction {
	public readonly Ended = new Signal<(report: IReport) => void>();
	private config: ITransactionConfig;
	private entities: ITransactEntity[] = [];
	private state: States = "Waiting";
	private transactionPromise: Promise<IReport> | undefined;

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

	private async startTransact(entity: ITransactEntity) {
		for (const i of $range(1, math.max(this.config.TransactionRepeats, 1))) {
			const [success] = entity.Transact().await();
			if (success) return;

			task.wait(this.config.RetryRate);
		}

		error("Transaction failed");
	}

	private async startRollback(entity: ITransactEntity) {
		for (const i of $range(1, math.max(this.config.TransactionRepeats, 1))) {
			const [success] = entity.Rollback().await();
			if (success) return;

			task.wait(this.config.RetryRate);
		}

		error("Rollback failed");
	}

	private async processTransaction() {
		const completeTransactions: ITransactEntity[] = [];

		for (const entity of this.entities) {
			const [success] = this.startTransact(entity).await();
			completeTransactions.push(entity);

			if (!success) return [false, completeTransactions] as const;
		}

		return [true, completeTransactions] as const;
	}

	private async processRollback(entities: ITransactEntity[]) {
		let success = true;

		for (const entity of entities) {
			const [successRollback] = this.startRollback(entity).await();
			if (!successRollback && success) success = false;
		}

		return success;
	}

	private async transact() {
		this.setState("Transact");
		this.initEntities();

		let code = TransactionStatusCode.Success;
		const [success, completeTransactions] = await this.processTransaction();

		if (!success && this.isState("Transact")) {
			code = TransactionStatusCode.TransactionFail;

			this.setState("Rollback");
			const successRollback = this.processRollback(completeTransactions).expect();

			!successRollback && (code = TransactionStatusCode.RollbackFail);
		}

		this.endTransact();
		this.transactionPromise = undefined;
		this.setState("Waiting");

		const report = success ? DoSuccessReport() : DoFailReport(code);
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
