# 🤝 Transaction 🤝
Transaction will allow you to conduct secure transactions using Transact, Rollback methods.

## Example
A code snippet showing how to set up and use Transaction.

```ts
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
```
