type QuerySnapshot<T> = [queryKey: readonly unknown[], data: T | undefined];

type QueryCacheWriter = {
  setQueryData: (queryKey: readonly unknown[], data: unknown) => unknown;
};

export function restoreQuerySnapshots<T>(client: QueryCacheWriter, snapshots?: QuerySnapshot<T>[]) {
  snapshots?.forEach(([queryKey, data]) => client.setQueryData(queryKey, data));
}
