import { ITransactEntity, Transaction } from "../transaction";

class TestEntity implements ITransactEntity {
	public Init() {
		print("Init");
	}
	public async Transact() {
		print("Manipulating the data");
		print("Data saving");
	}
	public async Rollback() {
		print("Here you can roll back the data to its original state");
	}
	public End() {
		print("End");
	}
}

const transaction = new Transaction([new TestEntity(), new TestEntity()]);
const transact = transaction.Transact().expect();
print(transact.StatusCodes);
