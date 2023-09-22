<?php

use App\Http\Controllers\CardController;
use App\Http\Controllers\GoogleController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "web" middleware group. Make something great!
|
*/

// test
Route::get('/api', [CardController::class, 'index'])->name('test');


Route::get('/api/google/login', [GoogleController::class, 'redirectToGoogle'])->name('google.login');
Route::get('/api/google/login/callback', [GoogleController::class, 'handleGoogleCallback']);

Route::middleware(['auth'])->group(function () {
    Route::get('/api/google/logout', [GoogleController::class, 'logout'])->name('google.logout');
    Route::get('/api/cards', [CardController::class, 'cards']);
    Route::get('/api/hello', function () {
        return response()->json(['message' => 'Hello World!']);
    });
});
