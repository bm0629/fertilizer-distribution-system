<?php

namespace App\Providers;

use App\Contracts\PaymentGatewayInterface;
use App\Services\HostedSubsidyGatewayService;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(PaymentGatewayInterface::class, HostedSubsidyGatewayService::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
