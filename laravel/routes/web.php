<?php

use App\Http\Controllers\CardController;
use App\Http\Controllers\GoogleController;
use App\Http\Controllers\LoginController;
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
Route::get('/login', [LoginController::class, 'showAuthOptions'])->name('login');

Route::get('/login/google', [GoogleController::class, 'redirectToGoogle']);
Route::get('/login/google/callback', [GoogleController::class, 'handleGoogleCallback']);
// Route::get('/logout/google')

Route::middleware(['auth'])->group(function () {
});