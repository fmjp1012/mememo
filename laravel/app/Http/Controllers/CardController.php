<?php

namespace App\Http\Controllers;

use App\Models\Card;
use Illuminate\Http\Request;

class CardController extends Controller
{
    //
    public function cards()
    {
        return Card::all();
    }
}
