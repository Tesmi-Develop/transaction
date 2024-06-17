/// <reference types="@rbxts/testez/globals" />

import { ITransactEntity, Transaction, TransactionStatusCode } from ".";

type Statuses = "Init" | "Transact" | "Rollback" | "End";

class TestEntity implements ITransactEntity {
	public statuses: Record<Statuses, boolean> = {
		Init: false,
		Transact: false,
		Rollback: false,
		End: false,
	};
	public Action: "Complete" | "Rollback" | "Fail" | "TransactionChain" = "Complete";

	public Init() {
		this.statuses.Init = true;
	}

	public async Transact() {
		if (this.Action === "TransactionChain") {
			return {
				repeats: 1,
				callback: async () => {
					return async () => {
						this.statuses.Transact = true;
					};
				},
			};
		}
		if (this.Action === "Rollback") {
			error("Transaction failed");
		}
		this.statuses.Transact = true;
	}

	public async Rollback() {
		if (this.Action === "Fail") {
			error("Rollback failed");
		}
		this.statuses.Rollback = true;
	}

	public End() {
		this.statuses.End = true;
	}
}

export = () => {
	it("Should complete transact", () => {
		const entities = [new TestEntity(), new TestEntity()];
		const transaction = new Transaction(entities);
		const result = transaction.Transact().expect();

		expect(entities[0].statuses.Init).to.equal(true);
		expect(entities[0].statuses.Transact).to.equal(true);
		expect(entities[0].statuses.Rollback).to.equal(false);
		expect(entities[0].statuses.End).to.equal(true);

		expect(entities[1].statuses.Init).to.equal(true);
		expect(entities[1].statuses.Transact).to.equal(true);
		expect(entities[1].statuses.Rollback).to.equal(false);
		expect(entities[1].statuses.End).to.equal(true);
		expect(result.StatusCodes).to.equal(TransactionStatusCode.Success);
	});

	it("Should rollback transact", () => {
		const entities = [new TestEntity(), new TestEntity()];
		entities[0].Action = "Rollback";
		const transaction = new Transaction(entities, { RetryRate: 0.1 });
		const result = transaction.Transact().expect();

		expect(entities[0].statuses.Rollback).to.equal(true);
		expect(entities[1].statuses.Rollback).to.equal(false);

		entities[0].statuses.Rollback = false;
		entities[0].Action = "Complete";
		entities[1].Action = "Rollback";

		transaction.Transact().await();

		expect(entities[0].statuses.Rollback).to.equal(true);
		expect(entities[1].statuses.Rollback).to.equal(true);
		expect(result.StatusCodes).to.equal(TransactionStatusCode.TransactionFail);
	});

	it("Should fail rollback transact", () => {
		const entities = [new TestEntity(), new TestEntity()];
		entities[0].Action = "Fail";
		entities[1].Action = "Rollback";
		const transaction = new Transaction(entities, { RetryRate: 0.1 });
		const result = transaction.Transact().expect();

		expect(entities[0].statuses.Rollback).to.equal(false);
		expect(entities[1].statuses.Rollback).to.equal(true);

		expect(result.StatusCodes).to.equal(TransactionStatusCode.RollbackFail);
	});

	it("Should complete transaction chain", () => {
		const entities = [new TestEntity(), new TestEntity()];
		const transaction = new Transaction(entities);
		const result = transaction.Transact().expect();

		expect(entities[0].statuses.Init).to.equal(true);
		expect(entities[0].statuses.Transact).to.equal(true);
		expect(entities[0].statuses.Rollback).to.equal(false);
		expect(entities[0].statuses.End).to.equal(true);

		expect(entities[1].statuses.Init).to.equal(true);
		expect(entities[1].statuses.Transact).to.equal(true);
		expect(entities[1].statuses.Rollback).to.equal(false);
		expect(entities[1].statuses.End).to.equal(true);
		expect(result.StatusCodes).to.equal(TransactionStatusCode.Success);
	});
};
