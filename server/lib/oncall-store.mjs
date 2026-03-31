function createEmptyState() {
  return {
    casesById: {},
    caseIdByChatId: {},
  };
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

export class OncallStore {
  constructor(_filePath, _log) {
    this.state = createEmptyState();
    this.initPromise = undefined;
    this.queue = Promise.resolve();
  }

  async init() {
    if (!this.initPromise) {
      this.initPromise = Promise.resolve();
    }

    await this.initPromise;
  }

  async read(reader) {
    await this.init();
    return reader(cloneValue(this.state));
  }

  async mutate(mutator) {
    await this.init();

    let result;
    const runMutation = async () => {
      result = await mutator(this.state);
    };

    this.queue = this.queue.then(runMutation, runMutation);

    await this.queue;
    return cloneValue(result);
  }
}
