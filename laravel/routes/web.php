<?php

use App\Http\Controllers\CardController;
use App\Http\Controllers\GoogleController;
use App\Http\Controllers\LoginController;
use App\Http\Controllers\SignupController;
use App\Http\Controllers\TopController;
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
Route::get('welcome', function () {
    return view('welcome');
});

// 表示
Route::get('/login', [LoginController::class, 'showAuthOptions'])->name('login');

// Login
Route::get('/login/google', [GoogleController::class, 'redirectToGoogle']);
Route::get('/login/google/callback', [GoogleController::class, 'handleGoogleCallback']);
// Route::get('/logout/google')

Route::middleware(['auth'])->group(function () {
    Route::get('/', [TopController::class, 'top'])->name('top');
});
