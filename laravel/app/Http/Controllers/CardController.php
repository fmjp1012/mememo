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
    public function store(Request $request)
    {
        $newCard = Card::create(
            [
                'user_id' => $request->userId,
                'question' => $request->question,
                'answer' => $request->answer,
            ]
        );
    }
    public function update(Request $request, int $cardId)
    {
        $card = Card::find($cardId);
        $card->update(
            [
                'question' => $request->question,
                'answer' => $request->answer,
            ]
        );
    }
    public function delete(Request $request, int $cardId)
    {
        $card = Card::find($cardId);
        $card->delete();
    }
}
