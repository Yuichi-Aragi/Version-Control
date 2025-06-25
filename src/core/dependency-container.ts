type Factory<T> = (container: DependencyContainer) => T;

/**
 * A simple dependency injection container that manages services as singletons.
 */
export class DependencyContainer {
    private services = new Map<string, any>();
    private factories = new Map<string, Factory<any>>();

    /**
     * Registers a factory function for a service. The factory will be called
     * only once to create the service instance.
     * @param name The unique identifier for the service.
     * @param factory The function that creates the service instance.
     */
    public register<T>(name: string, factory: Factory<T>): void {
        if (this.factories.has(name)) {
            console.warn(`DI: Service factory for "${name}" is being overwritten.`);
        }
        this.factories.set(name, factory);
    }

    /**
     * Resolves a service instance by its name. If the service has not been
     * created yet, its factory is invoked and the result is cached.
     * @param name The unique identifier for the service.
     * @returns The singleton instance of the service.
     */
    public resolve<T>(name: string): T {
        if (this.services.has(name)) {
            return this.services.get(name) as T;
        }

        const factory = this.factories.get(name);
        if (!factory) {
            throw new Error(`DI: No factory registered for service: ${name}`);
        }

        const instance = factory(this);
        this.services.set(name, instance); // Cache as a singleton
        return instance;
    }
}
