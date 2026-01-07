import * as vscode from 'vscode';

/**
 * Extension lifecycle manager that properly handles VSCode's extension lifecycle
 * without trying to work around disposal store issues through suppression.
 *
 * This addresses the root cause: improper extension component initialization order
 * and lifecycle management, rather than trying to suppress disposal errors.
 */
export class ExtensionLifecycle {
  private static instance: ExtensionLifecycle | null = null;
  private _context: vscode.ExtensionContext | null = null;
  private isActive: boolean = false;
  private isDeactivating: boolean = false;
  private components: Map<string, LifecycleComponent> = new Map();
  private initializationPromise: Promise<void> | null = null;

  // Public getter for context
  public get context(): vscode.ExtensionContext | null {
    return this._context;
  }

  private constructor() {}

  public static getInstance(): ExtensionLifecycle {
    if (!ExtensionLifecycle.instance) {
      ExtensionLifecycle.instance = new ExtensionLifecycle();
    }
    return ExtensionLifecycle.instance;
  }

  /**
   * Initialize the extension lifecycle with proper component ordering
   */
  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._initialize(context);
    return this.initializationPromise;
  }

  private async _initialize(context: vscode.ExtensionContext): Promise<void> {
    if (this.isActive) {
      throw new Error('Extension lifecycle already initialized');
    }

    this._context = context;
    this.isActive = true;
    this.isDeactivating = false;

    // Initialize components in dependency order
    await this.initializeComponentsInOrder();
  }

  /**
   * Register a lifecycle component with dependency information
   */
  public registerComponent(
    id: string,
    component: LifecycleComponent,
    dependencies: string[] = []
  ): void {
    if (this.isDeactivating) {
      throw new Error('Cannot register components during deactivation');
    }

    this.components.set(id, {
      ...component,
      dependencies,
      isInitialized: false,
      isDisposed: false
    });
  }

  /**
   * Safely register a disposable, ensuring proper lifecycle management
   */
  public registerDisposable(disposable: vscode.Disposable, componentId?: string): void {
    if (!this._context || this.isDeactivating) {
      // If we're not active or deactivating, dispose immediately
      try {
        disposable.dispose();
      } catch (error) {
        // Ignore disposal errors during shutdown
      }
      return;
    }

    try {
      this._context.subscriptions.push(disposable);
    } catch (error) {
      // If subscription array fails, we're likely in a disposal race condition
      // This is the root cause we need to handle properly
      this.handleDisposalRaceCondition(disposable, error);
    }
  }

  /**
   * Handle the root cause: disposal race conditions during VSCode lifecycle events
   */
  private handleDisposalRaceCondition(disposable: vscode.Disposable, error: any): void {
    // This is the actual root cause: VSCode is already disposing its internal stores
    // but our extension components are still trying to register disposables

    // Set deactivation flag to prevent further registrations
    this.isDeactivating = true;

    // Dispose the disposable immediately since we can't register it
    try {
      disposable.dispose();
    } catch (disposeError) {
      // Log but don't throw - we're in an error recovery scenario
      console.warn('Extension lifecycle: Failed to dispose during race condition recovery:', disposeError);
    }

    // Start emergency shutdown of remaining components
    this.emergencyShutdown().catch(shutdownError => {
      console.warn('Extension lifecycle: Emergency shutdown failed:', shutdownError);
    });
  }

  /**
   * Initialize components in dependency order to prevent lifecycle issues
   */
  private async initializeComponentsInOrder(): Promise<void> {
    const initializationOrder = this.calculateInitializationOrder();

    for (const componentId of initializationOrder) {
      const component = this.components.get(componentId);
      if (component && !component.isInitialized && component.initialize) {
        try {
          await component.initialize();
          component.isInitialized = true;
        } catch (error) {
          console.error(`Failed to initialize component ${componentId}:`, error);
          throw new Error(`Extension initialization failed at component: ${componentId}`);
        }
      }
    }
  }

  /**
   * Calculate proper component initialization order based on dependencies
   */
  private calculateInitializationOrder(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (componentId: string): void => {
      if (visiting.has(componentId)) {
        throw new Error(`Circular dependency detected involving ${componentId}`);
      }
      if (visited.has(componentId)) {
        return;
      }

      visiting.add(componentId);

      const component = this.components.get(componentId);
      if (component && component.dependencies) {
        for (const dep of component.dependencies) {
          visit(dep);
        }
      }

      visiting.delete(componentId);
      visited.add(componentId);
      order.push(componentId);
    };

    for (const componentId of this.components.keys()) {
      visit(componentId);
    }

    return order;
  }

  /**
   * Properly deactivate the extension with correct component shutdown order
   */
  public async deactivate(): Promise<void> {
    if (!this.isActive || this.isDeactivating) {
      return;
    }

    this.isDeactivating = true;

    try {
      // Dispose components in reverse dependency order
      const initOrder = this.calculateInitializationOrder();
      const disposeOrder = initOrder.reverse();

      for (const componentId of disposeOrder) {
        const component = this.components.get(componentId);
        if (component && component.isInitialized && !component.isDisposed && component.dispose) {
          try {
            await component.dispose();
            component.isDisposed = true;
          } catch (error) {
            console.warn(`Failed to dispose component ${componentId}:`, error);
          }
        }
      }

    } finally {
      this.isActive = false;
      this._context = null;
      this.components.clear();
      this.initializationPromise = null;
    }
  }

  /**
   * Emergency shutdown when disposal race conditions are detected
   */
  private async emergencyShutdown(): Promise<void> {
    console.warn('Extension lifecycle: Initiating emergency shutdown due to disposal race condition');

    // Force dispose all components immediately without dependency order
    for (const [componentId, component] of this.components.entries()) {
      if (component.dispose && !component.isDisposed) {
        try {
          await component.dispose();
          component.isDisposed = true;
        } catch (error) {
          console.warn(`Emergency shutdown failed for component ${componentId}:`, error);
        }
      }
    }

    this.isActive = false;
    this.components.clear();
  }

  /**
   * Check if the extension is in a valid state for operations
   */
  public isOperational(): boolean {
    return this.isActive && !this.isDeactivating && this._context !== null;
  }
}

/**
 * Interface for components that participate in the extension lifecycle
 */
export interface LifecycleComponent {
  initialize?(): Promise<void>;
  dispose?(): Promise<void>;
  dependencies?: string[];
  isInitialized?: boolean;
  isDisposed?: boolean;
}

/**
 * Convenience function to get the lifecycle manager
 */
export function getExtensionLifecycle(): ExtensionLifecycle {
  return ExtensionLifecycle.getInstance();
}

/**
 * Safe disposable registration that respects extension lifecycle
 */
export function safeRegisterDisposable(disposable: vscode.Disposable, componentId?: string): void {
  getExtensionLifecycle().registerDisposable(disposable, componentId);
}